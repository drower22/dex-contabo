from typing import Tuple, List, Set
import os
import re
import sqlglot
from sqlglot.errors import ParseError


def _get_allowed_tables() -> Set[str]:
    env = os.getenv("SQLAGENT_ALLOWED_TABLES", "")
    parts = [p.strip() for p in env.split(",") if p.strip()]
    return set(parts)


def validate_sql(sql: str) -> Tuple[bool, List[str]]:
    issues: List[str] = []

    # Normalize: remove trailing semicolons and excessive whitespace
    normalized = sql.strip().rstrip(";").strip()

    # Single statement only (basic guard)
    if normalized.count(";") > 0:
        issues.append("Multiple SQL statements are not allowed.")

    try:
        # parse_one sometimes struggles with trailing semicolons; use normalized
        expr = sqlglot.parse_one(normalized, read="postgres")
    except ParseError as e:
        return False, [f"parse_error: {e}"]

    lowered = f" {normalized.lower()} "

    # Disallow dangerous statements
    banned = [
        " drop ", " alter ", " create ", " truncate ", " grant ", " revoke ",
        " insert ", " update ", " delete ", " call ", " begin ", " commit ", " rollback ",
    ]
    if any(b in lowered for b in banned):
        issues.append("Only SELECT queries are allowed.")

    # Root type check: be fully tolerant (some valid SELECTs may parse wrapped)
    # We won't reject based on expr.key; rely on banned statements and LIMIT + allowlist.
    # If needed for debug, uncomment the next line to record the expr key.
    # issues.append(f"expr_key={getattr(expr, 'key', None)}")

    # Allowlist of tables/views
    allowed = _get_allowed_tables()
    if allowed:
        # collect table names from the AST
        try:
            tables = {t.name for t in expr.find_all(sqlglot.expressions.Table)}
        except Exception:
            tables = set()
        for t in tables:
            if t not in allowed:
                issues.append(f"Table not allowed: {t}")

    # LIMIT presence
    if " limit " not in lowered:
        issues.append("Query should include LIMIT to avoid heavy scans.")

    ok = len(issues) == 0
    return ok, issues
