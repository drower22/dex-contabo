import os
import sys
import traceback
import hashlib
import uuid
import json
from datetime import datetime, timezone

import pandas as pd
import numpy as np
from supabase import Client

# --- Constantes ---
TABLE_CONCILIATION = 'ifood_conciliation'
TABLE_FILES = 'received_files'
DEDUPE_IGNORE_KEYS = {'id', 'received_file_id', 'created_at', 'updated_at'}
# Mapeamentos de colunas – mantendo suporte ao layout legado e ao layout v3
COLUMNS_MAPPING_LEGACY = {
    'competencia': 'competence_date',
    'data_fato_gerador': 'event_date',
    'fato_gerador': 'event_trigger',
    'tipo_lancamento': 'transaction_type',
    'descricao_lancamento': 'transaction_description',
    'valor': 'gross_value',
    'base_calculo': 'calculation_base_value',
    'percentual_taxa': 'tax_percentage',
    'pedido_associado_ifood': 'ifood_order_id',
    'pedido_associado_ifood_curto': 'ifood_order_id_short',
    'pedido_associado_externo': 'external_order_id',
    'motivo_cancelamento': 'cancellation_reason',
    'descricao_ocorrencia': 'occurrence_description',
    'data_criacao_pedido_associado': 'order_creation_date',
    'data_repasse_esperada': 'expected_payment_date',
    'valor_transacao': 'transaction_value',
    'loja_id': 'store_id',
    'loja_id_curto': 'store_id_short',
    'loja_id_externo': 'store_id_external',
    'cnpj': 'cnpj',
    'titulo': 'title',
    'data_faturamento': 'billing_date',
    'data_apuracao_inicio': 'settlement_start_date',
    'data_apuracao_fim': 'settlement_end_date',
    'valor_cesta_inicial': 'initial_basket_value',
    'valor_cesta_final': 'final_basket_value',
    'responsavel_transacao': 'transaction_responsible',
    'canal_vendas': 'sales_channel',
    'impacto_no_repasse': 'payment_impact',
    'parcela_pagamento': 'payment_installment',
    'pedido_detalhes': 'order_details',  # tolera legado com essa coluna opcional
    'metodo_pagamento': 'payment_method',
    'bandeira_pagamento': 'payment_brand',
}

COLUMNS_MAPPING_V3 = {
    **COLUMNS_MAPPING_LEGACY,
    'pedido_detalhes': 'order_details',
    'id_saldo': 'balance_id',
    'metodo_pagamento': 'payment_method',
    'bandeira_pagamento': 'payment_brand',
}

V3_MARKERS = {'pedido_detalhes', 'id_saldo', 'metodo_pagamento', 'bandeira_pagamento'}
LEGACY_MARKERS = {'responsavel_transacao', 'base_calculo'}

# Colunas que identificam de forma estável uma linha (chave natural)
# Ajuste se necessário conforme o modelo de dados do iFood.
NATURAL_KEY_COLUMNS = [
    'competence_date',
    'event_date',
    'transaction_type',
    'transaction_description',
    'gross_value',  # Adicionado para diferenciar lançamentos com mesma descrição mas valores diferentes
    'transaction_value',  # Adicionado para diferenciar pelo saldo acumulado
    'ifood_order_id',
    'external_order_id',
    'store_id',
    'title',
    'billing_date',
    'settlement_start_date',
    'settlement_end_date',
    'payment_installment',
]  # balance_id pode diferenciar lançamentos no layout v3

# Se a planilha v3 fornecer id_saldo, ele auxilia na identificação única
if 'balance_id' not in NATURAL_KEY_COLUMNS:
    NATURAL_KEY_COLUMNS.append('balance_id')

# Colunas adicionais presentes no schema final
EXTRA_COLUMNS = [
    'order_details',
    'payment_method',
    'payment_brand',
    'balance_id',
    'layout_version',
]


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def normalize_layout_hint(layout_hint: str | None) -> str | None:
    if not layout_hint:
        return None
    layout_hint = layout_hint.strip().lower()
    if layout_hint in {'legacy', 'v3'}:
        return layout_hint
    return None


def detect_layout(columns: set[str], layout_hint: str | None = None) -> str:
    normalized_hint = normalize_layout_hint(layout_hint)
    if normalized_hint:
        return normalized_hint

    if V3_MARKERS.issubset(columns):
        return 'v3'
    # fallback legado por padrão
    return 'legacy'


def get_mapping_for_layout(layout_version: str) -> dict[str, str]:
    if layout_version == 'v3':
        return COLUMNS_MAPPING_V3
    return COLUMNS_MAPPING_LEGACY

def update_file_status(logger, supabase_client: Client, file_id: str, status: str, details: str = None):
    """Atualiza o status do registro em `public.received_files` e mantém consistência de colunas auxiliares.

    Regras:
    - pending: somente status; zera processed_at e erros
    - processing: idem pending
    - processed: seta processed_at = agora (UTC) e limpa erros
    - error: mantém processed_at nulo e preenche error_message/error_details
    """
    try:
        now_utc = datetime.now(timezone.utc).isoformat()
        update_data = {'status': status}

        if status in ('pending', 'processing'):
            update_data.update({
                'processed_at': None,
                'error_message': None,
                'error_details': None,
            })
        elif status == 'processed':
            update_data.update({
                'processed_at': now_utc,
                'error_message': None,
                'error_details': None,
            })
        elif status == 'error':
            short_msg = None
            if details:
                short_msg = details.splitlines()[0][:250]
            update_data.update({
                'processed_at': None,
                'error_message': short_msg,
                'error_details': details,
            })

        supabase_client.table(TABLE_FILES).update(update_data).eq('id', file_id).execute()
        logger.log('info', f"[files] id={file_id} -> status='{status}' atualizado com sucesso.")
    except Exception as e:
        logger.log('error', f"Falha ao atualizar status do arquivo {file_id}: {e}")

def _select_sheet_name(excel_file: pd.ExcelFile, layout_hint: str | None, logger) -> str:
    sheet_names = excel_file.sheet_names
    logger.log('info', f'Aba(s) disponíveis: {sheet_names}')
    if not sheet_names:
        raise ValueError('Arquivo Excel sem abas disponíveis.')

    normalized_hint = normalize_layout_hint(layout_hint)
    if normalized_hint == 'legacy' and len(sheet_names) > 1:
        logger.log('info', f'Layout hint "legacy" detectado. Utilizando aba de índice 1: {sheet_names[1]}')
        return sheet_names[1]
    if normalized_hint == 'v3':
        logger.log('info', f'Layout hint "v3" detectado. Utilizando aba de índice 0: {sheet_names[0]}')
        return sheet_names[0]

    # Heurística: se houver mais de uma aba, tentar a segunda (layout antigo) primeiro
    if len(sheet_names) > 1:
        return sheet_names[1]
    return sheet_names[0]


def read_and_clean_data(logger, file_path: str, layout_hint: str | None = None) -> tuple[pd.DataFrame, str]:
    """Lê a planilha de conciliação (CSV ou Excel), detecta layout (legacy/v3), cria dump bruto e aplica limpeza."""
    try:
        logger.log('info', 'Iniciando leitura da planilha...')
        
        # Detectar se é CSV ou Excel pela extensão
        file_extension = os.path.splitext(file_path)[1].lower()
        logger.log('info', f'Extensão detectada: {file_extension}')
        
        if file_extension == '.csv':
            # Ler como CSV - tentar detectar separador
            logger.log('info', 'Lendo arquivo como CSV...')
            # Tentar com separador ponto-e-vírgula primeiro (padrão iFood)
            try:
                original_df = pd.read_csv(file_path, sep=';', header=0, dtype=object, encoding='utf-8')
                logger.log('info', f'CSV lido com separador ";" - {len(original_df)} linhas')
            except Exception as e1:
                logger.log('warning', f'Falha ao ler com separador ";": {e1}. Tentando vírgula...')
                try:
                    original_df = pd.read_csv(file_path, sep=',', header=0, dtype=object, encoding='utf-8')
                    logger.log('info', f'CSV lido com separador "," - {len(original_df)} linhas')
                except Exception as e2:
                    logger.log('error', f'Falha ao ler CSV: {e2}')
                    raise
        else:
            # Ler como Excel
            logger.log('info', 'Lendo arquivo como Excel...')
            excel_file = pd.ExcelFile(file_path)
            selected_sheet = _select_sheet_name(excel_file, layout_hint, logger)

            try:
                original_df = excel_file.parse(sheet_name=selected_sheet, header=0, dtype=object)
            except ValueError as exc:
                logger.log('warning', f'Aba {selected_sheet} inválida ({exc}). Tentando aba 0 como fallback.')
                original_df = excel_file.parse(sheet_name=0, header=0, dtype=object)
        
        logger.log('info', f'{len(original_df)} linhas lidas da planilha.')

        columns_lower = {str(col).strip().lower() for col in original_df.columns}
        layout_version = detect_layout(columns_lower, layout_hint)
        logger.log('info', f'Layout detectado: {layout_version} (hint={layout_hint})')
        column_mapping = get_mapping_for_layout(layout_version)

        # Passa a trabalhar numa cópia que será limpa
        df = original_df.copy()
        # Converte NaN para None no dataframe antes do restante do pipeline
        df = df.replace({np.nan: None})

        df.rename(columns=column_mapping, inplace=True)
        logger.log('info', 'Colunas renomeadas com sucesso.')

        date_columns = [
            'competence_date', 'event_date', 'order_creation_date', 'expected_payment_date',
            'billing_date', 'settlement_start_date', 'settlement_end_date'
        ]
        for col in date_columns:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')
                df[col] = df[col].apply(lambda x: x.isoformat() if pd.notna(x) else None)

        id_columns = [
            'ifood_order_id', 'ifood_order_id_short', 'external_order_id',
            'store_id', 'store_id_short', 'store_id_external', 'cnpj',
            'balance_id'
        ]
        for col in id_columns:
            if col in df.columns:
                df[col] = df[col].astype(str).str.replace(r'\.0$', '', regex=True).replace('None', None)

        value_columns = [
            'gross_value', 'calculation_base_value', 'tax_percentage', 'transaction_value',
            'initial_basket_value', 'final_basket_value'
        ]
        for col in value_columns:
            if col in df.columns:
                df[col] = (
                    df[col]
                    .astype(str)
                    .str.replace(r'[^0-9,\.-]', '', regex=True)  # Mantém vírgula e ponto
                    .str.replace(',', '.', regex=False)           # Troca vírgula por ponto
                )
                df[col] = pd.to_numeric(df[col], errors='coerce')
                # Normaliza infinidades para NaN para posterior conversão a None
                df[col] = df[col].replace([np.inf, -np.inf], np.nan)
        
        final_columns = list(dict.fromkeys(column_mapping.values()))
        for extra in EXTRA_COLUMNS:
            if extra not in final_columns:
                final_columns.append(extra)
        # Garante que todas as colunas esperadas existam; se faltarem no Excel, cria com None
        missing_cols = [c for c in final_columns if c not in df.columns]
        if missing_cols:
            logger.log('warning', f"Colunas ausentes no arquivo: {missing_cols}. Preenchendo com None.")
            for col in missing_cols:
                df[col] = None

        df['layout_version'] = layout_version
        df = df[final_columns]
        # Após todas as transformações, converte NaN/±Inf para None para compatibilidade JSON
        df = df.replace({np.nan: None})
        logger.log('info', 'DataFrame finalizado e filtrado com as colunas corretas para o banco.')

        # Não remover duplicatas: manter 100% das linhas conforme planilha
        logger.log('info', 'Deduplicação desativada: todas as linhas da planilha serão mantidas.')

        # --- Log Explícito dos Dados (10 Primeiras Linhas) ---
        logger.log('info', '>>> INÍCIO DA AMOSTRA DE DADOS PROCESSADOS (10 primeiras linhas) <<<')
        logger.log('info', '\n================ AMOSTRA DAS 10 PRIMEIRAS LINHAS =================')
        for idx, row in df.head(10).iterrows():
            logger.log('info', f'Linha {idx}:')
            for col_name, value in row.items():
                logger.log('info', f'  Coluna: {col_name} | Valor: "{value}" | Tipo: {type(value).__name__}')
        logger.log('info', '===============================================================\n')
        logger.log('info', '>>> FIM DA AMOSTRA DE DADOS <<<')

        return df, layout_version

    except Exception as e:
        logger.log('error', f'Falha ao ler ou limpar os dados do Excel: {e}')
        raise

def _sanitize_value(v):
    try:
        # Trata pandas/NumPy NaN/Inf
        if pd.isna(v):
            return None
    except Exception:
        pass
    if isinstance(v, float) and (v == float('inf') or v == float('-inf')):
        return None
    return v

def _sanitize_record(d: dict) -> dict:
    return {k: _sanitize_value(v) for k, v in d.items()}

def safe_to_json(row, logger):
    """Converte uma linha para JSON de forma segura e compatível com JSON (sem NaN/Inf)."""
    try:
        data = _sanitize_record(row.to_dict())
        return json.dumps(data, ensure_ascii=False, allow_nan=False)
    except Exception as e:
        safe_dict = {k: str(v).encode('utf-8', 'ignore').decode('utf-8') for k, v in row.to_dict().items()}
        logger.log('warning', f"Falha de encoding ao serializar linha: {e}", {'problematic_row_data': safe_dict})
        return json.dumps({"error": f"Falha de encoding: {e}", "original_data_cleaned": safe_dict})

def save_data_in_batches(logger, supabase_client: Client, df: pd.DataFrame, account_id: str, file_id: str):
    """Prepara e salva os dados no Supabase em lotes, garantindo ausência de duplicidades."""
    logger.log('info', f'Iniciando preparação de {len(df)} registros para salvar no banco de dados.')

    # Remove previamente os registros associados a este received_file_id para evitar duplicidades
    try:
        logger.log('info', f"Removendo registros existentes em '{TABLE_CONCILIATION}' para received_file_id={file_id}...")
        delete_resp = supabase_client.table(TABLE_CONCILIATION).delete().eq('received_file_id', file_id).execute()
        deleted_count = 0
        if hasattr(delete_resp, 'data') and delete_resp.data:
            if isinstance(delete_resp.data, list):
                deleted_count = len(delete_resp.data)
            elif isinstance(delete_resp.data, dict):
                deleted_count = delete_resp.data.get('count') or 0
        logger.log('info', f'Remoção concluída. Registros apagados: {deleted_count}.')
    except Exception as exc:
        logger.log('warning', f'Falha ao remover registros anteriores (continuando com o processamento): {exc}')

    logger.log('info', 'Adicionando coluna account_id aos registros.')
    df['account_id'] = account_id


    logger.log('info', 'Adicionando coluna received_file_id aos registros.')
    df['received_file_id'] = file_id

    logger.log('info', f"[DEBUG] Colunas a serem salvas: {df.columns.tolist()} (total registros={len(df)})")
    records_to_insert = []
    for idx, rec in enumerate(df.to_dict(orient='records')):
        sanitized = _sanitize_record(rec)
        # Usar apenas NATURAL_KEY_COLUMNS para calcular o hash (garante unicidade correta)
        dedupe_basis = {k: sanitized.get(k) for k in NATURAL_KEY_COLUMNS if k in sanitized}
        # Adicionar índice da linha para garantir unicidade absoluta (evita duplicatas de linhas 100% idênticas)
        dedupe_basis['_row_index'] = idx
        base_payload = json.dumps(dedupe_basis, ensure_ascii=False, sort_keys=True, default=str)
        deterministic_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{account_id}|{base_payload}")
        sanitized['id'] = str(deterministic_id)
        # Calcular natural_hash para auditoria (MD5 do payload SEM row_index)
        natural_basis = {k: sanitized.get(k) for k in NATURAL_KEY_COLUMNS if k in sanitized}
        natural_payload = json.dumps(natural_basis, ensure_ascii=False, sort_keys=True, default=str)
        sanitized['natural_hash'] = hashlib.md5(natural_payload.encode('utf-8')).hexdigest()
        records_to_insert.append(sanitized)

    seen_ids: set[str] = set()
    unique_records = []
    skipped_in_file = 0
    for rec in records_to_insert:
        row_id = rec.get('id')
        if not row_id:
            unique_records.append(rec)
            continue
        if row_id in seen_ids:
            skipped_in_file += 1
            continue
        seen_ids.add(row_id)
        unique_records.append(rec)

    if skipped_in_file:
        logger.log('info', f'{skipped_in_file} linhas duplicadas no arquivo foram ignoradas (ID determinístico idêntico).')

    # Deletar registros antigos da mesma competência antes de inserir novos
    # Isso garante que sempre temos apenas a versão mais recente dos dados
    if unique_records:
        # Pegar competências únicas dos registros a inserir
        competences_to_delete: set[str] = set()
        for rec in unique_records:
            comp_date = rec.get('competence_date')
            if comp_date:
                # Extrair ano-mês da competência (YYYY-MM)
                if isinstance(comp_date, str) and len(comp_date) >= 7:
                    competences_to_delete.add(comp_date[:7])  # YYYY-MM

        if competences_to_delete:
            from datetime import datetime as _dt
            from datetime import date as _date

            logger.log('info', f'Deletando registros antigos das competências (account_id={account_id}): {sorted(competences_to_delete)}')

            for comp in sorted(competences_to_delete):
                try:
                    # comp vem no formato 'YYYY-MM'
                    try:
                        year, month = map(int, comp.split('-'))
                        month_start = _date(year, month, 1)
                        # calcular primeiro dia do mês seguinte
                        if month == 12:
                            next_month_start = _date(year + 1, 1, 1)
                        else:
                            next_month_start = _date(year, month + 1, 1)
                    except Exception as parse_exc:
                        logger.log('warning', f"Competência '{comp}' inválida para deleção: {parse_exc}")
                        continue

                    result = (
                        supabase_client
                        .table(TABLE_CONCILIATION)
                        .delete()
                        .eq('account_id', account_id)
                        .gte('competence_date', month_start.isoformat())
                        .lt('competence_date', next_month_start.isoformat())
                        .execute()
                    )
                    logger.log('info', f"Competência {comp} limpa para account_id {account_id} (intervalo {month_start.isoformat()} .. {next_month_start.isoformat()})")
                except Exception as e:
                    logger.log('warning', f'Falha ao deletar competência {comp} para account_id {account_id}: {e}')

    batch_size = 100
    total_batches = (len(unique_records) + batch_size - 1) // batch_size if unique_records else 0
    for batch_idx, start in enumerate(range(0, len(unique_records), batch_size), start=1):
        batch = unique_records[start:start + batch_size]
        try:
            logger.log('info', f'Enviando lote {batch_idx}/{total_batches} para o Supabase...')
            # Padrão definitivo: upsert por 'id' (sem fallbacks)
            supabase_client.table(TABLE_CONCILIATION).upsert(batch, on_conflict='id').execute()
        except Exception as e:
            msg = str(e)
            logger.log('error', f"Falha ao salvar lote via upsert por 'id': {msg}")
            if batch:
                logger.log('debug', f'Amostra do primeiro registro do lote que falhou: {json.dumps(batch[0], default=str)}')
            raise
    logger.log('info', 'Todos os lotes foram salvos com sucesso.')

def process_conciliation_file(logger, supabase_client: Client, file_path: str, file_id: str, account_id: str, layout_hint: str | None = None):
    """Orquestra o processo completo de ponta a ponta."""
    try:
        logger.set_context(file_id=file_id, account_id=account_id)
        logger.log('info', f'Iniciando processamento do arquivo de conciliação: {file_path}')
        update_file_status(logger, supabase_client, file_id, 'processing')

        df, layout_version = read_and_clean_data(logger, file_path, layout_hint=layout_hint)
        logger.log('info', f'Layout efetivamente processado: {layout_version}')

        if df is not None and not df.empty:
            save_data_in_batches(logger, supabase_client, df, account_id, file_id)
            update_file_status(logger, supabase_client, file_id, 'processed')
            logger.log('info', 'Processamento do arquivo concluído com sucesso.')
        else:
            update_file_status(logger, supabase_client, file_id, 'error', 'O arquivo Excel está vazio ou não contém dados na segunda aba.')

    except Exception as e:
        error_message = f"Erro fatal no processamento: {e}"
        tb_str = traceback.format_exc()
        details = f"{error_message}\n\nTraceback:\n{tb_str}"
        print(details, file=sys.stderr)
        if logger and supabase_client:
            logger.log('critical', error_message, {'traceback': tb_str})
            update_file_status(logger, supabase_client, file_id, 'error', details)
    finally:
        # A remoção do arquivo temporário é feita no processo principal (main.py)
        pass
