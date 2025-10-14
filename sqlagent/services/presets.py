from typing import Dict, Any, Tuple, List
import os
from ..infra.db import execute_sql
from .validators import validate_sql

ALLOWED_TABLE = os.getenv("SQLAGENT_ALLOWED_TABLES", "v_ifood_order_ledger") or "v_ifood_order_ledger"

# Presets de perguntas determinísticas (sem LLM)
# Obs.: usamos somente a view/tabela permitida em SQLAGENT_ALLOWED_TABLES.
# Todas as queries incluem LIMIT para satisfazer o validador e evitar scans pesados.

PRESETS: Dict[str, Dict[str, Any]] = {
    "totais_ultimos_dias": {
        "title": "Totais de pedidos e receita nos últimos N dias",
        "params": {
            "days": {"type": "int", "default": 7, "min": 1, "max": 365},
        },
        "sql": lambda p: (
            f"select count(*)::bigint as orders, coalesce(sum(final_amount),0)::numeric as revenue "
            f"from {ALLOWED_TABLE} "
            f"where fact_date >= now() - interval '{int(p.get('days', 7))} days' "
            f"limit 1;"
        ),
    },
    "diario_ultimos_dias": {
        "title": "Pedidos e receita por dia nos últimos N dias",
        "params": {
            "days": {"type": "int", "default": 7, "min": 1, "max": 365},
        },
        "sql": lambda p: (
            f"select date_trunc('day', fact_date)::date as dia, "
            f"       count(*)::bigint as orders, coalesce(sum(final_amount),0)::numeric as revenue "
            f"from {ALLOWED_TABLE} "
            f"where fact_date >= now() - interval '{int(p.get('days', 7))} days' "
            f"group by 1 order by 1 "
            f"limit 500;"
        ),
    },
    "status_ultimos_dias": {
        "title": "Pedidos por status nos últimos N dias",
        "params": {
            "days": {"type": "int", "default": 7, "min": 1, "max": 365},
        },
        "sql": lambda p: (
            f"select coalesce(status,'unknown') as status, "
            f"       count(*)::bigint as orders, coalesce(sum(final_amount),0)::numeric as revenue "
            f"from {ALLOWED_TABLE} "
            f"where fact_date >= now() - interval '{int(p.get('days', 7))} days' "
            f"group by 1 order by orders desc "
            f"limit 100;"
        ),
    },
}


def list_presets() -> Dict[str, Any]:
    return {
        "allowed_table": ALLOWED_TABLE,
        "items": {
            k: {"title": v["title"], "params": v["params"]}
            for k, v in PRESETS.items()
        },
    }


def run_preset(preset_id: str, params: Dict[str, Any]) -> Tuple[List[str], List[List[Any]], str]:
    if preset_id not in PRESETS:
        raise ValueError(f"Preset inválido: {preset_id}")

    # Sanitização simples de 'days'
    p = dict(params or {})
    if "days" in PRESETS[preset_id]["params"]:
        try:
            d = int(p.get("days", PRESETS[preset_id]["params"]["days"]["default"]))
        except Exception:
            d = PRESETS[preset_id]["params"]["days"]["default"]
        min_d = PRESETS[preset_id]["params"]["days"].get("min", 1)
        max_d = PRESETS[preset_id]["params"]["days"].get("max", 365)
        p["days"] = max(min_d, min(max_d, d))

    sql = PRESETS[preset_id]["sql"](p)
    ok, issues = validate_sql(sql)
    if not ok:
        raise ValueError("SQL inválido para o preset: " + "; ".join(issues))

    cols, rows = execute_sql(sql)
    return cols, rows, sql
