import time
import os
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from ..services.sqlgen import generate_sql
from ..services.presets import list_presets, run_preset
from ..services.intent import interpret, interpret_chat
from ..services.validators import validate_sql
from ..infra.db import list_schemas, execute_sql
from ..services.providers.openai import OpenAIProvider

router = APIRouter()


@router.get("/v1/sql/schemas")
async def get_schemas(request: Request):
    account_id = request.headers.get("x-account-id")
    return {"schemas": list_schemas(account_id)}


class GenerateBody(BaseModel):
    question: str
    hint_tables: list[str] | None = None


@router.post("/v1/sql/generate")
async def post_generate(body: GenerateBody, request: Request):
    account_id = request.headers.get("x-account-id")
    sql, rationale, model = generate_sql(question=body.question, account_id=account_id, hint_tables=body.hint_tables)
    ok, issues = validate_sql(sql)
    return {"sql": sql, "valid": ok, "issues": issues, "rationale": rationale, "model": model}


class ValidateBody(BaseModel):
    sql: str


@router.post("/v1/sql/validate")
async def post_validate(body: ValidateBody):
    ok, issues = validate_sql(body.sql)
    return {"valid": ok, "issues": issues}


class AskBody(BaseModel):
    question: str
    top_k: int | None = None
    date_from: str | None = None
    date_to: str | None = None


@router.post("/qa/interpret")
async def post_interpret(body: AskBody):
    data, model = interpret(body.question)
    return {"ok": True, "model": model, "interpretation": data}


class ChatMsg(BaseModel):
    role: str  # user|assistant
    content: str


class InterpretChatBody(BaseModel):
    history: list[ChatMsg]


@router.post("/qa/interpret_chat")
async def post_interpret_chat(body: InterpretChatBody):
    hist = [m.model_dump() for m in body.history]
    data, model = interpret_chat(hist)
    return {"ok": True, "model": model, "interpretation": data}


class ChatEchoBody(BaseModel):
    history: list[ChatMsg]


@router.post("/chat/echo")
async def post_chat_echo(body: ChatEchoBody):
    """Minimal chat endpoint: returns a text reply using OpenAI only, with request_id."""
    hist = [m.model_dump() for m in body.history]

    # request id for tracing
    import uuid
    req_id = str(uuid.uuid4())
    try:
        reply = OpenAIProvider().generate_text(hist)
        return {
            "ok": True,
            "request_id": req_id,
            "model": os.getenv("OPENAI_MODEL", "openai"),
            "reply": reply,
        }
    except Exception as e:
        return {
            "ok": False,
            "request_id": req_id,
            "detail": f"openai_err: {e}",
        }


@router.post("/qa/ask")
async def post_ask(body: AskBody, request: Request):
    """Recebe pergunta NL, gera SQL (Gemini/Llama), valida, executa e retorna dados.
    """
    t0 = time.time()
    account_id = request.headers.get("x-account-id")

    # 1) Interpretar pergunta para extrair parâmetros
    interp, interp_model = interpret(body.question)

    # 2) Se houver preset_candidate e last_n, tentar executar preset determinístico
    preset = (interp.get("preset_candidate") or "").strip() or None
    if preset and preset in {"totais_ultimos_dias", "diario_ultimos_dias", "status_ultimos_dias"}:
        params = {}
        if interp.get("last_n") and (interp.get("last_unit") in (None, "days")):
            params["days"] = int(interp["last_n"]) if str(interp["last_n"]).isdigit() else 7
        # Executa preset se conseguiu montar params
        if params:
            try:
                t0 = time.time()
                cols, rows, psql = run_preset(preset, params)
                timing_ms = int((time.time() - t0) * 1000)
                return {
                    "ok": True,
                    "model": interp_model,
                    "executed_sql": psql,
                    "columns": cols,
                    "rows": rows,
                    "interpretation": interp,
                    "timing_ms": timing_ms,
                }
            except Exception:
                pass  # se preset falhar, cai para o fluxo LLM->SQL

    # 3) Caso contrário, gera SQL via LLM (fluxo anterior)
    sql, rationale, model = generate_sql(question=body.question, account_id=account_id)
    ok, issues = validate_sql(sql)
    if not ok:
        raise HTTPException(status_code=400, detail={"message": "Query inválida", "issues": issues, "sql": sql})

    # Execução
    try:
        cols, rows = execute_sql(sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao executar SQL: {e}")

    timing_ms = int((time.time() - t0) * 1000)
    return {
        "ok": True,
        "model": model,
        "executed_sql": sql,
        "columns": cols,
        "rows": rows,
        "explanation": rationale,
        "interpretation": interp,
        "timing_ms": timing_ms,
    }


class PresetExecBody(BaseModel):
    preset_id: str
    params: dict | None = None


@router.get("/qa/presets")
async def get_presets():
    return list_presets()


@router.post("/qa/presets/build")
async def post_build_preset(body: PresetExecBody):
    """Somente constroi o SQL do preset sem executar (debug/inspecao)."""
    from ..services.presets import PRESETS  # lazy import for introspection
    if body.preset_id not in PRESETS:
        raise HTTPException(status_code=404, detail="Preset inexistente")
    params = body.params or {}
    try:
        sql = PRESETS[body.preset_id]["sql"](params)
        return {"ok": True, "sql": sql}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/qa/presets/run")
async def post_run_preset(body: PresetExecBody):
    try:
        cols, rows, sql = run_preset(body.preset_id, body.params or {})
        return {"ok": True, "columns": cols, "rows": rows, "executed_sql": sql}
    except Exception as e:
        # inclui o SQL gerado (se conseguir gerar) para facilitar o debug do cliente
        from ..services.presets import PRESETS  # local import
        sql_dbg = None
        try:
            if body.preset_id in PRESETS:
                sql_dbg = PRESETS[body.preset_id]["sql"](body.params or {})
        except Exception:
            pass
        raise HTTPException(status_code=400, detail={"message": str(e), "sql": sql_dbg})
