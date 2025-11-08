import os
from typing import Dict, Any, Optional, Tuple
from ..infra.supabase import get_supabase
from ..infra.whatsapp import WhatsAppClient


class FlowResult:
    def __init__(self, reply_text: Optional[str] = None, new_step: Optional[str] = None, context_patch: Optional[dict] = None):
        self.reply_text = reply_text
        self.new_step = new_step
        self.context_patch = context_patch or {}


def _get_state(conversation_id: str) -> Tuple[str, dict]:
    sb = get_supabase()
    resp = sb.table('wa_state').select('step, context').eq('conversation_id', conversation_id).maybe_single().execute()
    data = resp.data or {}
    return data.get('step') or 'welcome', (data.get('context') or {})


def _set_state(conversation_id: str, step: str, context: dict) -> None:
    sb = get_supabase()
    payload = {"conversation_id": conversation_id, "step": step, "context": context}
    # upsert by pk conversation_id
    sb.table('wa_state').upsert(payload, on_conflict='conversation_id').execute()


def handle_message(conversation: Dict[str, Any], message: Dict[str, Any]) -> FlowResult:
    """
    conversation: { id, account_id, contact_id, ... }
    message: WhatsApp inbound message payload già normalizado
    """
    step, context = _get_state(conversation['id'])
    text = (message.get('text') or {}).get('body') if message.get('type') == 'text' else None

    if step == 'welcome':
        reply = (
            "Olá! Eu sou o Dex. Como posso ajudar?\n"
            "1) Conciliação\n"
            "2) Relatório Financeiro\n"
            "3) Suporte"
        )
        new_step = 'menu'
        _set_state(conversation['id'], new_step, context)
        return FlowResult(reply_text=reply, new_step=new_step)

    if step == 'menu':
        choice = (text or '').strip()
        if choice.startswith('1'):
            reply = (
                "Perfeito! Para conciliação, envie sua planilha ou acesse o formulário web: /forms/upload.\n"
                "Se preferir, responda com seu account_id para eu já vincular:"
            )
            new_step = 'collect_account_for_conciliation'
        elif choice.startswith('2'):
            reply = "Ótimo! Para relatório financeiro, me diga o período (ex: 2025-08)."
            new_step = 'collect_period_finance'
        elif choice.startswith('3'):
            reply = "Nosso suporte vai te atender. Descreva brevemente seu problema."
            new_step = 'support_wait'
        else:
            reply = "Não entendi. Escolha 1, 2 ou 3."
            new_step = 'menu'
        _set_state(conversation['id'], new_step, context)
        return FlowResult(reply_text=reply, new_step=new_step)

    if step == 'collect_account_for_conciliation':
        account_id = (text or '').strip()
        if account_id:
            context['account_id'] = account_id
            _set_state(conversation['id'], 'conciliation_ready', context)
            reply = (
                f"Account {account_id} vinculado. Envie o arquivo .xlsx aqui mesmo ou use o formulário em /forms/upload."
            )
            return FlowResult(reply_text=reply, new_step='conciliation_ready', context_patch={'account_id': account_id})
        else:
            return FlowResult(reply_text="Por favor, envie um account_id válido.", new_step=step)

    if step == 'collect_period_finance':
        period = (text or '').strip()
        if period:
            context['period'] = period
            _set_state(conversation['id'], 'finance_ready', context)
            reply = (
                f"Período {period} registrado. Em breve trarei um resumo financeiro."
            )
            return FlowResult(reply_text=reply, new_step='finance_ready', context_patch={'period': period})
        else:
            return FlowResult(reply_text="Envie um período como AAAA-MM.", new_step=step)

    # Fallback
    _set_state(conversation['id'], 'welcome', context)
    return FlowResult(reply_text="Voltando ao início...", new_step='welcome')


def reply_via_whatsapp(to_number: str, result: FlowResult) -> Optional[dict]:
    if not result.reply_text:
        return None
    client = WhatsAppClient()
    return client.send_text(to=to_number, text=result.reply_text)
