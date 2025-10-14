import os
import time
import json
import math
from typing import Any, Dict, List, Optional

from dex.infra.supabase import get_supabase
from dex.services.whatsapp_flow import handle_message, reply_via_whatsapp

RATE_PER_SEC = float(os.getenv("WA_RATE_LIMIT_PER_SEC", "1"))  # msgs/seg
MAX_ATTEMPTS = int(os.getenv("WA_MAX_ATTEMPTS", "5"))
BATCH_SIZE = int(os.getenv("WA_BATCH_SIZE", "10"))
LOOP_SLEEP = float(os.getenv("WA_LOOP_SLEEP", "1"))  # segundos


def now_iso() -> str:
    # Supabase aceita 'now()' em updates, mas aqui só para logs
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _rate_sleep(last_sent_time: Optional[float]) -> float:
    if RATE_PER_SEC <= 0:
        return 0
    min_interval = 1.0 / RATE_PER_SEC
    if last_sent_time is None:
        return 0
    elapsed = time.monotonic() - last_sent_time
    if elapsed >= min_interval:
        return 0
    return max(0.0, min_interval - elapsed)


def _backoff_seconds(attempts: int) -> int:
    # Exponencial simples com limite
    base = [60, 300, 900, 3600]  # 1m, 5m, 15m, 60m
    idx = min(attempts - 1, len(base) - 1)
    return base[idx]


def _pick_queue(sb) -> List[Dict[str, Any]]:
    # Pega itens prontos para envio
    q = (
        sb.table('wa_outbox')
        .select('*')
        .eq('status', 'queued')
        .lte('scheduled_at', 'now()')
        .order('scheduled_at', desc=False)
        .limit(BATCH_SIZE)
        .execute()
    )
    return q.data or []


def _claim_item(sb, item_id: str) -> bool:
    # Marca como sending apenas se ainda estiver queued
    upd = (
        sb.table('wa_outbox')
        .update({'status': 'sending', 'updated_at': 'now()'})
        .eq('id', item_id)
        .eq('status', 'queued')
        .execute()
    )
    # Se nada foi atualizado, outro worker pegou
    return bool(getattr(upd, 'count', None) or (upd.data if hasattr(upd, 'data') else None))


def _finalize_success(sb, item: Dict[str, Any], resp: Dict[str, Any]):
    sb.table('wa_outbox').update({
        'status': 'sent',
        'attempts': (item.get('attempts') or 0) + 1,
        'last_error': None,
        'response_json': resp,
        'sent_at': 'now()',
        'updated_at': 'now()'
    }).eq('id', item['id']).execute()


def _finalize_failure(sb, item: Dict[str, Any], error_msg: str):
    attempts = (item.get('attempts') or 0) + 1
    if attempts >= MAX_ATTEMPTS:
        sb.table('wa_outbox').update({
            'status': 'failed',
            'attempts': attempts,
            'last_error': error_msg,
            'updated_at': 'now()'
        }).eq('id', item['id']).execute()
        return
    delay = _backoff_seconds(attempts)
    sb.table('wa_outbox').update({
        'status': 'queued',
        'attempts': attempts,
        'last_error': error_msg,
        'scheduled_at': f"now() + interval '{delay} seconds'",
        'updated_at': 'now()'
    }).eq('id', item['id']).execute()


def _build_components(item: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    # Se components já existe no outbox, prioriza
    components = item.get('components')
    if components:
        return components
    # Se houver variables, monta body
    variables = item.get('variables') or []
    if variables:
        return [{
            'type': 'body',
            'parameters': [{ 'type': 'text', 'text': str(v) } for v in variables]
        }]
    # Se houver user_name no item, também converte
    user_name = item.get('user_name')
    if user_name:
        return [{
            'type': 'body',
            'parameters': [{ 'type': 'text', 'text': str(user_name) }]
        }]
    return None


def process_once():
    sb = get_supabase()
    items = _pick_queue(sb)
    if not items:
        return 0
    client = WhatsAppClient()
    sent_count = 0
    last_sent = None
    for it in items:
        try:
            if not _claim_item(sb, it['id']):
                continue
            # Respeita rate
            sleep_s = _rate_sleep(last_sent)
            if sleep_s > 0:
                time.sleep(sleep_s)

            to = it.get('to_number') or it.get('user_number_normalized')
            if not to:
                _finalize_failure(sb, it, 'Missing to')
                continue
            template = it.get('template_name')
            lang = it.get('lang_code') or 'pt_BR'
            components = _build_components(it)

            print(f"[WORKER] Sending to={to} template={template} lang={lang} comps={components}")
            resp = client.send_template(to=to, template=template, language=lang, components=components)
            print(f"[WORKER] RESP: {resp}")
            _finalize_success(sb, it, resp)
            sent_count += 1
            last_sent = time.monotonic()
        except Exception as e:
            _finalize_failure(sb, it, str(e))
            print(f"[WORKER][ERR] id={it.get('id')} err={e}")
    return sent_count


def main():
    print(f"[WORKER] start rate={RATE_PER_SEC}/s batch={BATCH_SIZE} max_attempts={MAX_ATTEMPTS}")
    while True:
        try:
            n = process_once()
            if n == 0:
                time.sleep(LOOP_SLEEP)
        except KeyboardInterrupt:
            print("[WORKER] stop")
            break
        except Exception as e:
            print(f"[WORKER][FATAL] {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
