import json
import os
import re
from typing import Dict, Any, Optional, Tuple

# Providers
try:
    from .providers.openai import OpenAIProvider
except Exception:
    OpenAIProvider = None  # type: ignore

try:
    from .providers.gemini import GeminiProvider
except Exception:
    GeminiProvider = None  # type: ignore

try:
    from .providers.groq import GroqLlamaProvider
except Exception:
    GroqLlamaProvider = None  # type: ignore


INTENT_SCHEMA = {
    "user_query": "",
    "intent": "analytics",  # ex.: analytics|status|finance etc.
    "last_n": None,
    "last_unit": None,  # days|weeks|months
    "date_from": None,
    "date_to": None,
    "metrics": ["orders"],
    "dimensions": ["day"],
    "filters": [],  # [{"field":"channel","op":"=","value":"ifood"}]
    "table_hint": "v_ifood_order_ledger",
    "preset_candidate": None,  # totais_ultimos_dias|diario_ultimos_dias|status_ultimos_dias
    "limit": 100,
    # extras
    "channel": "ifood",
    "tenant": {"group_id": None, "store_id": None},
    "suggested_periods": [7, 14, 30, 90],
    "known_fields": [],  # canonical recognized fields
}

PROMPT = (
    "Você é um assistente que EXTRAI parâmetros estruturados de uma pergunta de negócio.\n"
    "Responda EXCLUSIVAMENTE em JSON válido, sem comentários, sem markdown.\n"
    "Campos esperados: {schema_keys}.\n"
    "Regras:\n"
    "- Se a pergunta trouxer período relativo (ex.: 'últimos 7 dias'), preencha last_n/last_unit.\n"
    "- Se trouxer datas absolutas (ex.: 'de 2024-06-01 a 2024-06-10'), use date_from/date_to (YYYY-MM-DD).\n"
    "- Se NÃO houver período, NÃO assuma padrão; deixe last_n/date_*, e traga suggested_periods=[7,14,30,90].\n"
    "- metrics e dimensions são listas de termos simples (ex.: ['orders','revenue']).\n"
    "- filters é uma lista de objetos {{field, op, value}}.\n"
    "- table_hint é uma vista ou tabela de leitura (ex.: v_ifood_order_ledger ou v_ifood_financial_conciliation).\n"
    "- Canal padrão é 'ifood' (preencha em channel).\n"
    "- Respeite tenant: preencha tenant.group_id/store_id se mencionado.\n"
    "- Reconheça e privilegie os campos canônicos: transaction_description, gross_value, payment_impact, event_date, expected_payment_date.\n"
    "  Aceite sinônimos, mas normalize para estes nomes em known_fields e em filters[].field.\n"
    "- preset_candidate pode ser: totais_ultimos_dias | diario_ultimos_dias | status_ultimos_dias.\n"
    "- Se algo não se aplicar, use null ou lista vazia.\n"
    "Pergunta: {question}\n"
)

_JSON_RE = re.compile(r"\{[\s\S]*\}\s*$")


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    # captura o último bloco JSON no texto
    m = _JSON_RE.search(text)
    raw = m.group(0) if m else text
    try:
        data = json.loads(raw)
    except Exception:
        # fallback simples: tenta normalizar aspas
        raw2 = raw.replace("'", '"')
        data = json.loads(raw2)
    return data


_FIELD_SYNONYMS = {
    "transaction_description": {"descricao da transacao", "descrição da transação", "descricao", "description"},
    "gross_value": {"valor bruto", "gross", "bruto"},
    "payment_impact": {"impacto no pagamento", "impacto pagamento", "impacto"},
    "event_date": {"data do evento", "data evento"},
    "expected_payment_date": {"data prevista de pagamento", "data prevista", "previsao pagamento", "previsão de pagamento"},
}


def _normalize(data: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(INTENT_SCHEMA)
    out.update({k: data.get(k, out.get(k)) for k in out.keys()})
    # coerções leves
    if isinstance(out.get("last_n"), str) and out["last_n"].isdigit():
        out["last_n"] = int(out["last_n"])
    if not isinstance(out.get("metrics"), list):
        out["metrics"] = []
    if not isinstance(out.get("dimensions"), list):
        out["dimensions"] = []
    if not isinstance(out.get("filters"), list):
        out["filters"] = []
    if out.get("limit") is None:
        out["limit"] = 100
    # channel default
    if not out.get("channel"):
        out["channel"] = "ifood"
    # normalize filters fields to canonical names and collect known_fields
    known = set(out.get("known_fields") or [])
    def _canon(name: str) -> str:
        n = (name or "").strip().lower()
        for canon, syns in _FIELD_SYNONYMS.items():
            if n == canon or n in syns:
                return canon
        return name
    filters = out.get("filters") or []
    nf = []
    for f in filters:
        if isinstance(f, dict) and "field" in f:
            cf = _canon(str(f.get("field")))
            if cf != f.get("field"):
                f["field"] = cf
            nf.append(f)
            known.add(cf)
    out["filters"] = nf
    out["known_fields"] = sorted(list(known))
    # table_hint heuristic: financial conciliation if payment-related fields appear
    finance_fields = {"payment_impact", "expected_payment_date"}
    if any(k in out["known_fields"] for k in finance_fields):
        out["table_hint"] = "v_ifood_financial_conciliation"
    else:
        out["table_hint"] = out.get("table_hint") or "v_ifood_order_ledger"
    return out


def interpret(question: str) -> Tuple[Dict[str, Any], str]:
    """Returns (intent_dict, model_used)."""
    prompt = PROMPT.format(schema_keys=list(INTENT_SCHEMA.keys()), question=question)

    errors = []

    if OpenAIProvider is not None and os.getenv("OPENAI_API_KEY"):
        try:
            txt = OpenAIProvider(model=os.getenv("OPENAI_MODEL")).generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, os.getenv("OPENAI_MODEL", "openai")
        except Exception as e:
            errors.append(f"openai_err: {e}")

    if GeminiProvider is not None and os.getenv("GEMINI_API_KEY"):
        try:
            from .providers.gemini import GeminiProvider as _G
            txt = _G(model=os.getenv("GEMINI_MODEL")).generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, "gemini"
        except Exception as e:
            errors.append(f"gemini_err: {e}")

    if GroqLlamaProvider is not None and os.getenv("GROQ_API_KEY"):
        try:
            txt = GroqLlamaProvider().generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, "llama"
        except Exception as e:
            errors.append(f"llama_err: {e}")

    # fallback mínimo
    return _normalize({"user_query": question, "preset_candidate": "totais_ultimos_dias"}), "fallback"


def interpret_chat(history: list[dict]) -> Tuple[Dict[str, Any], str]:
    """Multi-turn interpretation. history is a list of {role: user|assistant, content: str}.
    Returns (intent_dict, model_used).
    """
    conv = "\n".join([f"{m.get('role','user')}: {m.get('content','')}" for m in history])
    q_last = next((m.get('content','') for m in reversed(history) if m.get('role')=='user'), '')
    prompt = (
        PROMPT +
        "\nHistórico de conversa (apenas contexto, extraia parâmetros do diálogo como um todo):\n" +
        conv +
        "\nObservação: Responda SOMENTE com JSON válido conforme schema.\n"
    ).format(schema_keys=list(INTENT_SCHEMA.keys()), question=q_last)

    errors = []

    if OpenAIProvider is not None and os.getenv("OPENAI_API_KEY"):
        try:
            txt = OpenAIProvider(model=os.getenv("OPENAI_MODEL")).generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, os.getenv("OPENAI_MODEL", "openai")
        except Exception as e:
            errors.append(f"openai_err: {e}")

    if GeminiProvider is not None and os.getenv("GEMINI_API_KEY"):
        try:
            from .providers.gemini import GeminiProvider as _G
            txt = _G(model=os.getenv("GEMINI_MODEL")).generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, "gemini"
        except Exception as e:
            errors.append(f"gemini_err: {e}")

    if GroqLlamaProvider is not None and os.getenv("GROQ_API_KEY"):
        try:
            txt = GroqLlamaProvider().generate_sql(prompt)
            data = _normalize(_extract_json(txt))
            return data, "llama"
        except Exception as e:
            errors.append(f"llama_err: {e}")

    return _normalize({"user_query": q_last or (history[-1]["content"] if history else ""), "preset_candidate": "totais_ultimos_dias"}), "fallback"
