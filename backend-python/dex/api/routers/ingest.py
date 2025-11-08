"""
Router para ingestão on-demand de conciliação iFood.
Endpoint temporário que aceita requisições mas não processa (retorna 202 Accepted).
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/api/ingest", tags=["Ingestão"])


class ReconciliationRequest(BaseModel):
    storeId: Optional[str] = Field(None, description="ID interno da loja (account_id)")
    accountId: Optional[str] = Field(None, description="Alias para storeId")
    merchantId: str = Field(..., description="merchantId iFood")
    competence: str = Field(..., description="Competência YYYY-MM")
    triggerSource: Optional[str] = Field(None, description="Origem do gatilho na UI")


@router.post("/ifood-reconciliation")
async def trigger_ifood_reconciliation(payload: ReconciliationRequest):
    """
    Endpoint stub para reconhecer solicitações de conciliação.
    TODO: Integrar com worker/orquestrador para processar de fato.
    """
    effective_store_id = payload.storeId or payload.accountId
    
    print(f"[INGEST] Conciliação solicitada: merchantId={payload.merchantId}, competence={payload.competence}, source={payload.triggerSource}")
    
    # Retorna 202 Accepted para evitar erro 405 na UI
    return {
        "status": "accepted",
        "message": "Conciliação reconhecida (processamento não implementado)",
        "storeId": effective_store_id,
        "merchantId": payload.merchantId,
        "competence": payload.competence,
        "triggerSource": payload.triggerSource or "unknown",
    }
