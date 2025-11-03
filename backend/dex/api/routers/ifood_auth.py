"""
Router FastAPI para autenticação distribuída iFood (OAuth 2.0).

Endpoints implementados:
- POST /api/ifood-auth/link?scope=reviews|financial - Gera userCode para vínculo
- POST /api/ifood-auth/exchange?scope=reviews|financial - Troca authorizationCode por tokens
- POST /api/ifood-auth/refresh?scope=reviews|financial - Renova tokens usando refreshToken
- GET /api/ifood-auth/status?accountId=...&scope=... - Verifica status da autenticação

Variáveis de ambiente necessárias:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ENCRYPTION_KEY (para criptografar tokens)
- IFOOD_BASE_URL (default: https://merchant-api.ifood.com.br)
- IFOOD_CLIENT_ID ou IFOOD_CLIENT_ID_REVIEWS / IFOOD_CLIENT_ID_FINANCIAL
- IFOOD_CLIENT_SECRET ou IFOOD_CLIENT_SECRET_REVIEWS / IFOOD_CLIENT_SECRET_FINANCIAL
"""
import os
import base64
import httpx
from datetime import datetime, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel
from supabase import create_client, Client
from cryptography.fernet import Fernet

# Configuração
IFOOD_BASE_URL = os.getenv("IFOOD_BASE_URL", "https://merchant-api.ifood.com.br")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")

if not all([SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY]):
    raise RuntimeError("Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
fernet = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)

router = APIRouter(prefix="/api/ifood-auth", tags=["iFood Auth"])

# Modelos Pydantic
class LinkRequest(BaseModel):
    storeId: Optional[str] = None
    merchantId: Optional[str] = None

class ExchangeRequest(BaseModel):
    storeId: str
    authorizationCode: str
    authorizationCodeVerifier: str

class RefreshRequest(BaseModel):
    storeId: str  # merchantId do iFood

# Helpers
def get_client_credentials(scope: Optional[str]) -> tuple[str, str]:
    """Retorna (clientId, clientSecret) baseado no scope."""
    if scope == "financial":
        client_id = os.getenv("IFOOD_CLIENT_ID_FINANCIAL") or os.getenv("IFOOD_CLIENT_ID")
        client_secret = os.getenv("IFOOD_CLIENT_SECRET_FINANCIAL") or os.getenv("IFOOD_CLIENT_SECRET")
    elif scope == "reviews":
        client_id = os.getenv("IFOOD_CLIENT_ID_REVIEWS") or os.getenv("IFOOD_CLIENT_ID")
        client_secret = os.getenv("IFOOD_CLIENT_SECRET_REVIEWS") or os.getenv("IFOOD_CLIENT_SECRET")
    else:
        client_id = os.getenv("IFOOD_CLIENT_ID")
        client_secret = os.getenv("IFOOD_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail=f"Missing iFood credentials for scope: {scope}")
    
    return client_id, client_secret

def encrypt_token(token: str) -> str:
    """Criptografa e retorna em base64."""
    return fernet.encrypt(token.encode()).decode()

def decrypt_token(encrypted: str) -> str:
    """Descriptografa de base64."""
    return fernet.decrypt(encrypted.encode()).decode()

# Rotas
@router.post("/link")
async def link(
    scope: Optional[Literal["reviews", "financial"]] = Query(None),
    body: LinkRequest = Body(...)
):
    """
    Gera userCode para vincular loja no Portal do Parceiro iFood.
    
    Query params:
    - scope: 'reviews' ou 'financial' (opcional, default usa IFOOD_CLIENT_ID)
    
    Body:
    - storeId: ID interno da loja (opcional, para persistência)
    - merchantId: ID do merchant no iFood (opcional, para lookup)
    """
    client_id, _ = get_client_credentials(scope)
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode",
                data={"clientId": client_id},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"iFood API error: {str(e)}")
    
    # Persistência opcional
    store_id = body.storeId
    if not store_id and body.merchantId:
        # Lookup storeId via merchantId
        result = supabase.table("accounts").select("id").eq("ifood_merchant_id", body.merchantId).maybe_single().execute()
        if result.data:
            store_id = result.data["id"]
    
    if store_id:
        try:
            supabase.table("ifood_store_auth").upsert({
                "account_id": store_id,
                "scope": scope or "reviews",
                "link_code": data.get("userCode"),
                "verifier": data.get("authorizationCodeVerifier"),
                "status": "pending"
            }, on_conflict="account_id,scope").execute()
        except Exception as e:
            # Não bloquear resposta se persistência falhar
            print(f"[ifood-auth/link] persist warning: {e}")
    
    return data

@router.post("/exchange")
async def exchange(
    scope: Optional[Literal["reviews", "financial"]] = Query(None),
    body: ExchangeRequest = Body(...)
):
    """
    Troca authorizationCode por access_token e refresh_token.
    
    Query params:
    - scope: 'reviews' ou 'financial'
    
    Body:
    - storeId: ID interno da loja
    - authorizationCode: código retornado pelo Portal
    - authorizationCodeVerifier: verifier do /link
    """
    client_id, client_secret = get_client_credentials(scope)
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{IFOOD_BASE_URL}/authentication/v1.0/oauth/token",
                data={
                    "grantType": "authorization_code",
                    "clientId": client_id,
                    "clientSecret": client_secret,
                    "authorizationCode": body.authorizationCode,
                    "authorizationCodeVerifier": body.authorizationCodeVerifier
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10.0
            )
            response.raise_for_status()
            token_data = response.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"iFood API error: {str(e)}")
    
    # Extrair merchantId
    merchant_id = (
        token_data.get("merchantId") or 
        token_data.get("merchantID") or 
        token_data.get("merchant_id") or 
        token_data.get("merchant", {}).get("id")
    )
    
    # Fallback: extrair do JWT
    if not merchant_id and token_data.get("accessToken"):
        try:
            import json
            payload_b64 = token_data["accessToken"].split(".")[1]
            # Adicionar padding se necessário
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            merchant_scope = payload.get("merchant_scope") or payload.get("merchantScope") or []
            if merchant_scope and isinstance(merchant_scope, list):
                merchant_id = merchant_scope[0].split(":")[0]
        except Exception:
            pass
    
    if not merchant_id:
        raise HTTPException(status_code=500, detail="Could not resolve merchantId from token")
    
    # Persistir tokens criptografados
    expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expiresIn", 3600))
    
    supabase.table("ifood_store_auth").upsert({
        "account_id": body.storeId,
        "scope": scope or "reviews",
        "ifood_merchant_id": merchant_id,
        "access_token": encrypt_token(token_data["accessToken"]),
        "refresh_token": encrypt_token(token_data["refreshToken"]),
        "expires_at": expires_at.isoformat(),
        "status": "connected"
    }, on_conflict="account_id,scope").execute()
    
    # Atualizar merchant_id na tabela accounts
    supabase.table("accounts").update({
        "ifood_merchant_id": merchant_id
    }).eq("id", body.storeId).execute()
    
    return {
        "access_token": token_data["accessToken"],
        "refresh_token": token_data["refreshToken"],
        "expires_in": token_data.get("expiresIn")
    }

@router.post("/refresh")
async def refresh(
    scope: Optional[Literal["reviews", "financial"]] = Query(None),
    body: RefreshRequest = Body(...)
):
    """
    Renova tokens usando refreshToken.
    
    Query params:
    - scope: 'reviews' ou 'financial'
    
    Body:
    - storeId: merchantId do iFood (será mapeado para account_id interno)
    """
    client_id, client_secret = get_client_credentials(scope)
    
    # Mapear merchantId -> account_id
    result = supabase.table("accounts").select("id").eq("ifood_merchant_id", body.storeId).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Store not found or not connected")
    
    account_id = result.data["id"]
    
    # Buscar refresh_token
    auth_result = supabase.table("ifood_store_auth").select("refresh_token").eq("account_id", account_id).eq("scope", scope or "reviews").maybe_single().execute()
    if not auth_result.data or not auth_result.data.get("refresh_token"):
        raise HTTPException(status_code=404, detail="Refresh token not found")
    
    refresh_token = decrypt_token(auth_result.data["refresh_token"])
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{IFOOD_BASE_URL}/authentication/v1.0/oauth/token",
                data={
                    "grantType": "refresh_token",
                    "clientId": client_id,
                    "clientSecret": client_secret,
                    "refreshToken": refresh_token
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10.0
            )
            response.raise_for_status()
            token_data = response.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"iFood API error: {str(e)}")
    
    # Atualizar tokens
    expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expiresIn", 3600))
    
    supabase.table("ifood_store_auth").update({
        "access_token": encrypt_token(token_data["accessToken"]),
        "refresh_token": encrypt_token(token_data["refreshToken"]),
        "expires_at": expires_at.isoformat(),
        "status": "connected"
    }).eq("account_id", account_id).eq("scope", scope or "reviews").execute()
    
    return {
        "access_token": token_data["accessToken"],
        "refresh_token": token_data["refreshToken"],
        "expires_in": token_data.get("expiresIn")
    }

@router.get("/status")
async def status(
    accountId: str = Query(..., description="ID interno da conta/loja"),
    scope: Literal["reviews", "financial"] = Query(..., description="Escopo da integração")
):
    """
    Verifica status da autenticação iFood para uma conta específica.
    
    Query params:
    - accountId: ID interno da loja
    - scope: 'reviews' ou 'financial'
    
    Retorna:
    - status: 'connected' | 'pending' | 'error'
    - message: descrição do status
    """
    result = supabase.table("ifood_store_auth").select("status, refresh_token, access_token, expires_at").eq("account_id", accountId).eq("scope", scope).maybe_single().execute()
    
    if not result.data:
        return {
            "status": "pending",
            "message": "No authentication record found for this account and scope"
        }
    
    data = result.data
    
    # Verifica se tem refresh_token
    if not data.get("refresh_token"):
        return {
            "status": "pending",
            "message": "Authentication not completed - missing refresh token"
        }
    
    # Verifica expiração
    if data.get("expires_at"):
        expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
        if expires_at < datetime.utcnow():
            return {
                "status": "connected",
                "message": "Token expired but can be refreshed",
                "expired": True
            }
    
    # Retorna status armazenado
    stored_status = (data.get("status") or "").lower()
    
    if stored_status in ["connected", "active"]:
        return {
            "status": "connected",
            "message": "Authentication active"
        }
    
    if stored_status in ["error", "failed"]:
        return {
            "status": "error",
            "message": "Authentication failed or revoked"
        }
    
    return {
        "status": "pending",
        "message": "Authentication in progress"
    }
