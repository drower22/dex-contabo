# Re-sincronização forçada para garantir deploy da versão sem 'novos_kpis'
import pandas as pd
import numpy as np
import sys
import os

# --- Solução Definitiva para o Problema de Módulo ---
# Adiciona o diretório raiz do projeto ao sys.path para que as importações de módulos funcionem
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import datetime
import json
import time
import traceback
import uuid
from supabase import create_client, Client
from dotenv import load_dotenv
import argparse

# --- Configuração do Supabase e .env ---
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
dotenv_path = os.path.join(project_root, '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- Constantes do Schema ---
TABLE_SALES_DATA = 'sales_data'
TABLE_RECEIVED_FILES = 'received_files'
TABLE_LOGS = 'logs'

# --- Sistema de Logging Centralizado ---
class SupabaseLogger:
    def __init__(self, supabase_client: Client):
        self.supabase = supabase_client
        self.file_id = None
        self.account_id = None
        self.log_buffer = []

    def set_context(self, file_id: str = None, account_id: str = None):
        if file_id: self.file_id = file_id
        if account_id: self.account_id = account_id

    def log(self, level: str, message: str, context: dict = None):
        payload = {
            "level": level.upper(),
            "message": message,
            "file_id": self.file_id,
            "account_id": self.account_id,
            "context": context
            # "source": "processor_script" # Coluna removida para compatibilidade com o DB
        }
        self.log_buffer.append(payload)
        if level.lower() in ["error", "critical", "warning"]:
            print(f"[{level.upper()}] {message}")

    def flush(self):
        if not self.log_buffer:
            return
        try:
            self.supabase.table(TABLE_LOGS).insert(self.log_buffer).execute()
            self.log_buffer = []
        except Exception as e:
            print(f"[CRITICAL] Falha ao escrever logs no Supabase: {e}", file=sys.stderr)
            print(f"[CRITICAL] Logs perdidos: {self.log_buffer}", file=sys.stderr)

# Colunas esperadas no arquivo Excel
EXPECTED_COLUMNS = [
    'id_do_pedido', 'id_do_pedido_na_loja', 'data_do_pedido', 'canal_de_venda',
    'valor_dos_produtos', 'taxa_de_entrega', 'taxa_adicional_de_entrega',
    'taxa_de_servico', 'descontos', 'beneficios_ifood', 'valor_total_do_pedido',
    'valor_liquido_do_pedido', 'tipo_de_pagamento', 'metodo_de_pagamento',
    'id_da_transacao_do_pagamento', 'tipo_de_pedido', 'modalidade_de_entrega',
    'entregador', 'id_do_cliente', 'nome_do_cliente', 'cpf_na_nota'
]

def init_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("As variáveis de ambiente SUPABASE_URL e SUPABASE_KEY são obrigatórias.")
    return create_client(url, key)

def update_file_status(logger: SupabaseLogger, supabase: Client, file_id: str, status: str, error_message: str = None):
    try:
        update_data = {"status": status, "processed_at": datetime.datetime.now().isoformat()}
        if error_message:
            update_data["error_details"] = error_message

        supabase.table(TABLE_RECEIVED_FILES).update(update_data).eq("id", file_id).execute()
        logger.log('info', f"Status do arquivo atualizado para '{status}'.")
    except Exception as e:
        logger.log('error', f"FALHA CRÍTICA ao atualizar status do arquivo: {e}")

def read_and_clean_data(logger: SupabaseLogger, file_path: str) -> pd.DataFrame:
    logger.log('info', f"Iniciando leitura do arquivo: {file_path}")
    try:
        # 0. Detecta automaticamente a linha de cabeçalho nas primeiras linhas
        import pandas as _pd
        sample = _pd.read_excel(file_path, header=None, nrows=10)
        def _norm(s):
            return str(s).lower().strip().replace(' ', '_').replace('n°', 'numero').replace('ç', 'c').replace('ã', 'a').replace('é', 'e')
        # Conjunto de colunas indicativas do relatório financeiro
        indicative = {
            'numero_pedido', 'pedido_id_completo', 'total_do_pedido', 'valor_dos_itens',
            'taxa_de_entrega', 'taxa_de_servico', 'data_de_repasse', 'valor_liquido'
        }
        best_row, best_score = 0, -1
        for r in range(sample.shape[0]):
            row_vals = [_norm(v) for v in list(sample.iloc[r].values)]
            score = sum(1 for v in row_vals if v in indicative)
            if score > best_score:
                best_score = score
                best_row = r
        # Se encontrou uma linha com ao menos 3 colunas indicativas, usa como header
        if best_score >= 3:
            logger.log('info', f"Cabeçalho detectado automaticamente na linha {best_row} (score={best_score}).")
            df = pd.read_excel(file_path, header=best_row, dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
        logger.log('info', f"{len(df)} linhas brutas lidas do arquivo.")

        # 1. Normaliza os nomes das colunas para bater com o schema do banco
        df.columns = [c.lower().strip().replace(' ', '_').replace('n°', 'numero').replace('ç', 'c').replace('ã', 'a').replace('é', 'e') for c in df.columns]
        logger.log('info', f'Nomes de colunas normalizados: {list(df.columns)}')
        # print(f'[DEBUG] Colunas normalizadas: {list(df.columns)}')  # Removido para evitar excesso de logs

        # 2. Define as colunas que precisam de tratamento especial (dinheiro, percentual, data)
        money_columns = [
            'total_do_pedido', 'valor_dos_itens', 'taxa_de_entrega', 'taxa_de_servico',
            'promocao_custeada_pelo_ifood', 'promocao_custeada_pela_loja',
            'valor_comissao_ifood', 'comissao_pela_transacao_do_pagamento',
            'valor_taxa_plano_repasse_1_semana', 'base_de_calculo', 'valor_bruto',
            'solicitacao_servicos_entrega_ifood', 'desconto_solicitacao_entrega_ifood',
            'valor_liquido', 'valor_ocorrencia'
        ]
        percent_columns = [
            'percentual_comissao_ifood',
            'percentual_pela_transacao_do_pagamento',
            'percentual_taxa_plano_de_repasse_em_1_semana'
        ]
        date_columns = ['data_do_pedido_ocorrencia', 'data_de_conclusao', 'data_de_repasse']

        # 3. Funções de conversão definitivas e específicas
        def parse_as_cents(value):
            """Lê um valor, trata como centavos e divide por 100."""
            if pd.isna(value): return None
            try:
                # Converte para número, ignorando texto, e divide por 100
                return float(value) / 100.0
            except (ValueError, TypeError):
                # Se a conversão falhar, tenta limpar a string primeiro
                if isinstance(value, str):
                    try:
                        cleaned_value = value.replace('R$', '').strip()
                        return float(cleaned_value) / 100.0
                    except (ValueError, TypeError):
                        return None
                return None

        def parse_as_decimal(value):
            """Lê um valor no padrão brasileiro (com vírgula) e converte para decimal."""
            if pd.isna(value): return None
            if isinstance(value, (int, float)): return float(value)
            if isinstance(value, str):
                try:
                    cleaned_value = value.replace('R$', '').strip().replace('.', '').replace(',', '.')
                    return float(cleaned_value)
                except (ValueError, TypeError):
                    return None
            return None

        # 4. Corrigir apenas a coluna 'total_do_pedido' com lógica definitiva para todos os formatos
        if 'total_do_pedido' in df.columns:
            def parse_total_do_pedido(value):
                if pd.isna(value): return None
                s = str(value).replace('R$', '').strip()
                # Caso 1: padrão brasileiro com vírgula (ex: 126,00)
                if ',' in s:
                    cleaned = s.replace('.', '').replace(',', '.')
                    try:
                        return float(cleaned)
                    except (ValueError, TypeError):
                        return None
                # Caso 2: tem ponto e termina com .00 (ex: 126.00)
                if '.' in s:
                    parts = s.split('.')
                    if len(parts[-1]) == 2:
                        try:
                            return float(s)
                        except (ValueError, TypeError):
                            return None
                # Caso 3: inteiro grande (ex: 12600)
                try:
                    num = float(s)
                    if num == int(num) and abs(num) > 99:
                        return num / 100.0
                    return num
                except (ValueError, TypeError):
                    return None
            df['total_do_pedido'] = df['total_do_pedido'].apply(parse_total_do_pedido)

        # Conversão robusta para colunas percentuais
        def parse_percent(value):
            if isinstance(value, str):
                value = value.replace('%', '').replace(',', '.').strip()
            if value == '' or value is None:
                return None
            try:
                val = float(value)
                # Se vier como fração (ex: 0.11), converte para percentual (11.0)
                if 0 < val <= 1:
                    val = val * 100
                # Garante apenas uma casa decimal
                return round(val, 1)
            except Exception:
                # logger.log('debug', f"Valor inválido para conversão de percentual: {value}")
                return None
        for col in percent_columns:
            if col in df.columns:
                print(f'[DEBUG] Antes do parse_percent na coluna {col}:', df[col].tolist())
                df[col] = df[col].apply(parse_percent)
                print(f'[DEBUG] Depois do parse_percent na coluna {col}:', df[col].tolist())

        for col in date_columns:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce')

        logger.log('info', 'Limpeza e conversão de tipos concluída.')

        # Renomeia colunas específicas para corresponder ao schema final do banco de dados
        rename_map = {
            'desconto_na_solicitacao_de_entrega_ifood': 'desconto_solicitacao_entrega_ifood',
            'solicitacao_de_servicos_de_entrega_ifood': 'solicitacao_servicos_entrega_ifood'
        }
        df.rename(columns=rename_map, inplace=True)

        return df

    except Exception as e:
        logger.log('error', f"Falha ao ler ou limpar o arquivo: {e}", context={'traceback': traceback.format_exc()})
        raise

def save_sales_data(logger: SupabaseLogger, supabase: Client, df: pd.DataFrame, account_id: str, file_id: str):
    logger.log('info', f"Iniciando preparação de {len(df)} registros para o banco de dados.")
    
    df['account_id'] = account_id
    df['received_file_id'] = file_id
    
    # Criação da chave de upsert condicional:
    # Criação da chave de upsert robusta para evitar duplicatas no mesmo lote.
    # A chave será uma combinação de colunas que garantem a unicidade do lançamento.
    # Para linhas sem 'numero_pedido', um UUID único ainda será usado como fallback.
    logger.log('info', "Gerando 'upsert_key' robusta para cada registro.")
    
    key_cols = [
        'numero_pedido',
        'pedido_id_completo',
        'data_de_repasse',
        'valor_bruto',
        'valor_ocorrencia'
    ]

    def create_upsert_key(row):
        import hashlib
        try:
            # Ocorrência avulsa: gera chave determinística baseada em campos essenciais
            if str(row.get('tipo_de_faturamento', '')).strip().lower() == 'ocorrência avulsa':
                base = (
                    str(row.get('account_id', '')) + '|' +
                    str(row.get('loja_id', '')) + '|' +
                    str(row.get('data_do_pedido_ocorrencia', '')) + '|' +
                    str(row.get('valor_ocorrencia', '')) + '|' +
                    str(row.get('tipo_de_faturamento', ''))
                )
                return hashlib.md5(base.encode('utf-8')).hexdigest()
            # Caso padrão: pedido normal, usa pedido_id_completo se disponível
            if pd.notna(row.get('pedido_id_completo')) and str(row.get('pedido_id_completo')).strip() != '':
                unique_parts = [str(row.get(col, '')) for col in key_cols]
                base_key = '_'.join(unique_parts)
                # Anexa o índice da linha para garantir unicidade absoluta no lote.
                return f"{base_key}_{row.name}"
        except Exception:
            pass
        # Fallback definitivo: Se a lógica acima falhar ou não for aplicável,
        # gera um UUID único para garantir que a inserção não falhe por chave nula.
        key = uuid.uuid4().hex
        if not key:
            logger.log('critical', f"FATAL: upsert_key gerada como NULA para a linha de índice {row.name}. Dados da linha: {row.to_dict()}")
        return key

    df['upsert_key'] = df.apply(create_upsert_key, axis=1)

    # Debug: Verificar se ainda existem duplicatas na chave gerada
    duplicates = df[df.duplicated(subset=['upsert_key'], keep=False)]
    if not duplicates.empty:
        logger.log('warning', f"Atenção: {len(duplicates)} linhas com 'upsert_key' duplicado foram encontradas APÓS a geração da chave robusta.")
        # logger.log('debug', f"Linhas duplicadas para inspeção:\n{duplicates[['upsert_key'] + key_cols].to_string()}")  # Removido para evitar excesso de logs
    
    # Define as colunas de data que precisam ser convertidas para string
    date_columns = ['data_do_pedido_ocorrencia', 'data_de_conclusao', 'data_de_repasse']

    # Converte as colunas de data para string no formato ISO 8601 para ser compatível com JSON
    for col in date_columns:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: x.isoformat() if pd.notnull(x) else None)

    # Substituir NaT e NaN por None para compatibilidade com JSON/Supabase
    df_for_insert = df.replace({np.nan: None, pd.NaT: None})

    # Gerar upsert_key estável: se houver pedido_id_completo, usa ele; senão, gera hash de campos estáveis
    import hashlib
    final_db_columns = [
        'account_id', 'received_file_id', 'loja_id', 'nome_da_loja', 'tipo_de_faturamento',
        'canal_de_vendas', 'numero_pedido', 'pedido_id_completo', 'data_do_pedido_ocorrencia',
        'data_de_conclusao', 'data_de_repasse', 'origem_de_forma_de_pagamento', 'formas_de_pagamento',
        'total_do_pedido', 'valor_dos_itens', 'taxa_de_entrega', 'taxa_de_servico',
        'promocao_custeada_pelo_ifood', 'promocao_custeada_pela_loja', 'percentual_comissao_ifood',
        'valor_comissao_ifood', 'percentual_pela_transacao_do_pagamento', 'comissao_pela_transacao_do_pagamento',
        'percentual_taxa_plano_repasse_1_semana', 'valor_taxa_plano_repasse_1_semana', 'base_de_calculo',
        'valor_bruto', 'solicitacao_servicos_entrega_ifood', 'desconto_solicitacao_entrega_ifood',
        'valor_liquido', 'valor_ocorrencia', 'upsert_key'
    ]

    # Garante unicidade de upsert_key no DataFrame antes de montar records
    df_for_insert = df_for_insert.drop_duplicates(subset=['upsert_key'], keep='last')
    # Filtra o dataframe para conter apenas as colunas que serão enviadas.
    cols_to_send = [col for col in final_db_columns if col in df_for_insert.columns]
    records = df_for_insert[cols_to_send].to_dict(orient='records')
    
    if not records:
        logger.log('warning', "Nenhum registro válido para inserir.")
        return

    # -------- NOVO: Filtrar duplicados idênticos e processar em lotes --------
    BATCH_SIZE = 500
    colunas_relevantes = [col for col in cols_to_send if col not in ['upsert_key']]  # ajuste se necessário

    # Buscar todos os pedido_id_completo já existentes em lotes
    logger.log('info', 'Buscando pedido_id_completo já existentes no banco...')
    existing_rows = {}
    offset = 0
    while True:
        res = supabase.table('sales_data').select(','.join(['pedido_id_completo'] + colunas_relevantes)).range(offset, offset+BATCH_SIZE-1).execute()
        if not res.data:
            break
        for row in res.data:
            existing_rows[row['pedido_id_completo']] = row
        if len(res.data) < BATCH_SIZE:
            break
        offset += BATCH_SIZE

    def is_identical(new_row, existing_row):
        for col in colunas_relevantes:
            if new_row.get(col) != existing_row.get(col):
                return False
        return True

    # Filtrar registros a enviar
    to_upsert = []
    for row in records:
        pid = row['pedido_id_completo']
        if pid not in existing_rows:
            to_upsert.append(row)
        elif not is_identical(row, existing_rows[pid]):
            to_upsert.append(row)  # Vai atualizar porque mudou algo
        # Se for idêntico, ignora

    logger.log('info', f'{len(to_upsert)} registros realmente novos ou alterados serão enviados ao Supabase.')
    # Enviar em lotes
    for i in range(0, len(to_upsert), BATCH_SIZE):
        batch = to_upsert[i:i+BATCH_SIZE]
        supabase.table('sales_data').upsert(batch, on_conflict=['upsert_key']).execute()

def processar_relatorio_financeiro(supabase: Client, logger: SupabaseLogger, file_path: str, file_id: str, account_id: str):
    """
    Processamento EXCLUSIVO do relatório financeiro do iFood.
    Pode ser chamada de outros módulos.
    """
    logger.set_context(file_id=file_id, account_id=account_id)

    try:
        logger.log("INFO", f"Iniciando processamento do arquivo: {file_path}")
        update_file_status(logger, supabase, file_id, 'processing')

        df = read_and_clean_data(logger, file_path)
        if df is None:
            raise ValueError("A leitura e limpeza dos dados falhou. O DataFrame está vazio.")

        save_sales_data(logger, supabase, df, account_id, file_id)
        
        update_file_status(logger, supabase, file_id, 'processed')
        logger.log("INFO", "Processamento concluído com sucesso.")
        print(json.dumps({"status": "success", "file_id": file_id}))

    except Exception as e:
        error_message = f"Erro no processamento: {e}"
        tb_str = traceback.format_exc()
        logger.log("ERROR", error_message, context={"traceback": tb_str})
        update_file_status(logger, supabase, file_id, 'error', error_message)
        print(json.dumps({"status": "error", "message": str(e), "file_id": file_id}))
    
    finally:
        logger.flush()

def main():
    """Função para execução via linha de comando."""
    parser = argparse.ArgumentParser(description="Processa um relatório financeiro do iFood e salva no Supabase.")
    parser.add_argument('--filepath', required=True, help='Caminho para o arquivo de relatório .xlsx.')
    parser.add_argument('--account-id', required=True, type=str, help='ID da conta (UUID).')
    parser.add_argument('--file-record-id', required=True, type=str, help='ID do registro do arquivo (UUID).')
    args = parser.parse_args()

    supabase_client = init_supabase_client()
    logger = SupabaseLogger(supabase_client)
    
    processar_relatorio_financeiro(supabase_client, logger, args.filepath, args.file_record_id, args.account_id)

if __name__ == "__main__":
    main()