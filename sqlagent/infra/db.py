import os
from typing import List, Dict, Tuple, Any
import psycopg
from psycopg.rows import dict_row

_CONN = None


def _get_conn():
    global _CONN
    if _CONN is None or _CONN.closed:
        dsn = os.getenv("READONLY_DB_URL")
        if not dsn:
            raise RuntimeError("READONLY_DB_URL não definido para o SQL Agent.")
        _CONN = psycopg.connect(dsn, autocommit=True)
    return _CONN


def list_schemas(account_id: str | None) -> List[Dict[str, str]]:
    """
    Retorna lista de tabelas e colunas disponíveis (públicas) para ajudar o LLM/cliente.
    Em produção, restrinja por views específicas da conta ou policies RLS.
    """
    conn = _get_conn()
    q = """
    select table_schema, table_name, column_name, data_type
    from information_schema.columns
    where table_schema not in ('pg_catalog','information_schema')
    order by table_schema, table_name, ordinal_position
    limit 2000
    """
    with conn.cursor() as cur:
        cur.execute(q)
        rows = cur.fetchall()
    result = [
        {
            "schema": r[0],
            "table": r[1],
            "column": r[2],
            "type": r[3],
        }
        for r in rows
    ]
    return result


def execute_sql(sql: str) -> Tuple[List[str], List[List[Any]]]:
    """
    Executa a query SQL (somente SELECT) usando a conexão READONLY com timeout.
    Retorna (columns, rows) no formato amigável para JSON.
    """
    timeout_ms = int(os.getenv("SQLAGENT_TIMEOUT_MS", "15000") or 15000)
    conn = _get_conn()
    # aplica statement_timeout por sessão
    with conn.cursor() as cur:
        cur.execute(f"SET LOCAL statement_timeout = {timeout_ms}")
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        records = cur.fetchall()
        if not records:
            return [], []
        columns = list(records[0].keys())
        rows = [[r.get(c) for c in columns] for r in records]
        return columns, rows
