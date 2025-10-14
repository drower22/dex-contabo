import os
from typing import Tuple, Optional, List, Dict

from .validators import validate_sql

# Providers
try:
    from .providers.gemini import GeminiProvider
except Exception:
    GeminiProvider = None  # type: ignore

try:
    from .providers.groq import GroqLlamaProvider
except Exception:
    GroqLlamaProvider = None  # type: ignore

try:
    from .providers.openai import OpenAIProvider
except Exception:
    OpenAIProvider = None  # type: ignore

DEFAULT_LIMIT = int(os.getenv("SQLAGENT_DEFAULT_LIMIT", "100") or 100)
MAX_LIMIT = int(os.getenv("SQLAGENT_MAX_LIMIT", "500") or 500)
DATE_DEFAULT_DAYS = int(os.getenv("SQLAGENT_DATE_DEFAULT_DAYS", "30") or 30)
ALLOWED_TABLES = os.getenv("SQLAGENT_ALLOWED_TABLES", "v_ifood_order_ledger")


PROMPT_TEMPLATE = (
    "Você é um assistente que gera SQL PostgreSQL para responder perguntas de negócio.\n"
    "Regras:\n"
    "- Use SOMENTE as tabelas/views permitidas: {allowed}.\n"
    "- Apenas SELECT; PROIBIDO DDL/DML.\n"
    "- Se a pergunta não especificar período, aplique filtro dos últimos {date_days} dias usando a coluna de data principal fact_date. Exemplo: fact_date >= now() - interval '{date_days} days'.\n"
    "- SEMPRE inclua LIMIT (<= {max_limit}). Se não houver, use LIMIT {default_limit}.\n"
    "- Responda apenas com o SQL puro, sem comentários.\n"
)


def _build_prompt(question: str, hint_tables: Optional[List[str]] = None) -> str:
    allowed = ALLOWED_TABLES
    if hint_tables:
        allowed = ",".join(hint_tables)
    return PROMPT_TEMPLATE.format(
        allowed=allowed,
        date_days=DATE_DEFAULT_DAYS,
        max_limit=MAX_LIMIT,
        default_limit=DEFAULT_LIMIT,
    ) + f"\nPergunta: {question}\nSQL:"


def _ensemble_generate(question: str, hint_tables: Optional[List[str]] = None) -> Tuple[str, str, str]:
    """Try OpenAI (gpt), Gemini, then Groq/Llama. Returns (sql, rationale, model)."""
    prompt = _build_prompt(question, hint_tables)

    errors: List[str] = []

    if OpenAIProvider is not None and os.getenv("OPENAI_API_KEY"):
        try:
            sql = OpenAIProvider().generate_sql(prompt)
            ok, issues = validate_sql(sql)
            if ok:
                return sql, "openai_ok", os.getenv("OPENAI_MODEL", "openai")
            errors.append(f"openai_invalid: {issues}")
        except Exception as e:
            errors.append(f"openai_err: {e}")

    if GeminiProvider is not None and os.getenv("GEMINI_API_KEY"):
        try:
            sql = GeminiProvider().generate_sql(prompt)
            ok, issues = validate_sql(sql)
            if ok:
                return sql, "gemini_ok", "gemini"
            errors.append(f"gemini_invalid: {issues}")
        except Exception as e:
            errors.append(f"gemini_err: {e}")

    if GroqLlamaProvider is not None and os.getenv("GROQ_API_KEY"):
        try:
            sql = GroqLlamaProvider().generate_sql(prompt)
            ok, issues = validate_sql(sql)
            if ok:
                return sql, "llama_ok", "llama"
            errors.append(f"llama_invalid: {issues}")
        except Exception as e:
            errors.append(f"llama_err: {e}")

    # last resort: very safe fallback
    fallback = f"select now()::date as dia, 0::numeric as total limit {DEFAULT_LIMIT};"
    return fallback, "; ".join(errors) or "fallback", "fallback"


def generate_sql(question: str, account_id: str | None = None, hint_tables: Optional[List[str]] = None) -> Tuple[str, str, str]:
    """Return (sql, rationale, model). account_id reserved for future tenant guards."""
    return _ensemble_generate(question, hint_tables)
