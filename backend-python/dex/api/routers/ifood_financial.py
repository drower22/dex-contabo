"""
Router para endpoints de Financial API do iFood (Settlements & Anticipations)
"""
import os
import httpx
from fastapi import APIRouter, HTTPException, Header, Query
from typing import Optional
from supabase import create_client

router = APIRouter(prefix="/api/ifood/financial", tags=["iFood Financial"])

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
IFOOD_BASE_URL = os.environ.get("IFOOD_BASE_URL", "https://merchant-api.ifood.com.br")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None


@router.get("/payouts")
async def get_payouts_unified(
    accountId: str,
    from_date: str = Query(None, alias="from"),
    to: str = None,
    authorization: Optional[str] = Header(None)
):
    """
    Retorna settlements + anticipations unificados para uma conta
    
    Query params:
    - accountId: ID da conta no Supabase
    - from: Data inicial (YYYY-MM-DD)
    - to: Data final (YYYY-MM-DD)
    
    Headers:
    - Authorization: Bearer {token} (opcional, busca do Supabase se não fornecido)
    """
    if not accountId:
        raise HTTPException(status_code=400, detail="Missing accountId parameter")
    
    if not from_date or not to:
        raise HTTPException(status_code=400, detail="Missing from/to date parameters")
    
    # 1. Busca access token
    access_token = None
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:]
    else:
        if not supabase:
            raise HTTPException(status_code=500, detail="Supabase not configured")
        
        auth_data = supabase.table("ifood_store_auth")\
            .select("access_token")\
            .eq("account_id", accountId)\
            .eq("scope", "financial")\
            .maybe_single()\
            .execute()
        
        if auth_data.data and auth_data.data.get("access_token"):
            access_token = auth_data.data["access_token"]
    
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="No access token found. Financial scope not authorized for this account"
        )
    
    # 2. Busca merchantId
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    
    account_data = supabase.table("accounts")\
        .select("ifood_merchant_id")\
        .eq("id", accountId)\
        .single()\
        .execute()
    
    if not account_data.data or not account_data.data.get("ifood_merchant_id"):
        raise HTTPException(status_code=404, detail="Merchant ID not found for this account")
    
    merchant_id = account_data.data["ifood_merchant_id"]
    
    # 3. Busca settlements
    settlements_url = f"{IFOOD_BASE_URL}/financial/v3/settlements"
    settlements_params = {
        "merchantId": merchant_id,
        "beginPaymentDate": from_date,
        "endPaymentDate": to
    }
    
    settlements_data = None
    async with httpx.AsyncClient() as client:
        try:
            settlements_response = await client.get(
                settlements_url,
                params=settlements_params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "accept": "application/json"
                },
                timeout=30.0
            )
            if settlements_response.status_code == 200:
                settlements_data = settlements_response.json()
        except Exception as e:
            print(f"[ERROR] Settlements API: {e}")
    
    # 4. Busca anticipations
    anticipations_url = f"{IFOOD_BASE_URL}/financial/v3.0/merchants/{merchant_id}/anticipations"
    anticipations_params = {
        "beginAnticipatedPaymentDate": from_date,
        "endAnticipatedPaymentDate": to
    }
    
    anticipations_data = None
    async with httpx.AsyncClient() as client:
        try:
            anticipations_response = await client.get(
                anticipations_url,
                params=anticipations_params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "accept": "application/json"
                },
                timeout=30.0
            )
            if anticipations_response.status_code == 200:
                anticipations_data = anticipations_response.json()
        except Exception as e:
            print(f"[ERROR] Anticipations API: {e}")
    
    # 5. Retorna resposta unificada
    return {
        "accountId": accountId,
        "from": from_date,
        "to": to,
        "settlements": settlements_data,
        "anticipations": anticipations_data
    }


@router.get("/anticipations")
async def get_anticipations_only(
    accountId: str,
    from_date: str = Query(None, alias="from"),
    to: str = None,
    authorization: Optional[str] = Header(None)
):
    """Retorna apenas antecipações"""
    if not accountId or not from_date or not to:
        raise HTTPException(status_code=400, detail="Missing required parameters")
    
    # Busca token
    access_token = None
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:]
    else:
        if not supabase:
            raise HTTPException(status_code=500, detail="Supabase not configured")
        
        auth_data = supabase.table("ifood_store_auth")\
            .select("access_token")\
            .eq("account_id", accountId)\
            .eq("scope", "financial")\
            .maybe_single()\
            .execute()
        
        if auth_data.data:
            access_token = auth_data.data.get("access_token")
    
    if not access_token:
        raise HTTPException(status_code=401, detail="No access token found")
    
    # Busca merchantId
    account_data = supabase.table("accounts")\
        .select("ifood_merchant_id")\
        .eq("id", accountId)\
        .single()\
        .execute()
    
    if not account_data.data or not account_data.data.get("ifood_merchant_id"):
        raise HTTPException(status_code=404, detail="Merchant ID not found")
    
    merchant_id = account_data.data["ifood_merchant_id"]
    
    # Chama API iFood
    url = f"{IFOOD_BASE_URL}/financial/v3.0/merchants/{merchant_id}/anticipations"
    params = {
        "beginAnticipatedPaymentDate": from_date,
        "endAnticipatedPaymentDate": to
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            params=params,
            headers={
                "Authorization": f"Bearer {access_token}",
                "accept": "application/json"
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"iFood API error: {response.text}"
            )
        
        return response.json()


@router.get("/settlements")
async def get_settlements_only(
    accountId: str,
    from_date: str = Query(None, alias="from"),
    to: str = None,
    authorization: Optional[str] = Header(None)
):
    """Retorna apenas settlements"""
    if not accountId or not from_date or not to:
        raise HTTPException(status_code=400, detail="Missing required parameters")
    
    # Busca token
    access_token = None
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:]
    else:
        if not supabase:
            raise HTTPException(status_code=500, detail="Supabase not configured")
        
        auth_data = supabase.table("ifood_store_auth")\
            .select("access_token")\
            .eq("account_id", accountId)\
            .eq("scope", "financial")\
            .maybe_single()\
            .execute()
        
        if auth_data.data:
            access_token = auth_data.data.get("access_token")
    
    if not access_token:
        raise HTTPException(status_code=401, detail="No access token found")
    
    # Busca merchantId
    account_data = supabase.table("accounts")\
        .select("ifood_merchant_id")\
        .eq("id", accountId)\
        .single()\
        .execute()
    
    if not account_data.data or not account_data.data.get("ifood_merchant_id"):
        raise HTTPException(status_code=404, detail="Merchant ID not found")
    
    merchant_id = account_data.data["ifood_merchant_id"]
    
    # Chama API iFood
    url = f"{IFOOD_BASE_URL}/financial/v3/settlements"
    params = {
        "merchantId": merchant_id,
        "beginPaymentDate": from_date,
        "endPaymentDate": to
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            params=params,
            headers={
                "Authorization": f"Bearer {access_token}",
                "accept": "application/json"
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"iFood API error: {response.text}"
            )
        
        return response.json()
