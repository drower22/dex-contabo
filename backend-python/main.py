import os
import sys
import subprocess
import traceback
import re
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from supabase import create_client, Client
from dotenv import load_dotenv
import uuid

# Ajuste de caminho para permitir importações tanto via 'backend.*' quanto locais
_THIS_FILE_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_FILE_DIR, '..'))
for _p in (_PROJECT_ROOT, _THIS_FILE_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)
# Importações diretas do pacote local "dex". Manter o bloco simples evita conflitos com
# bibliotecas externas que possam usar o nome "backend".
from dex.api.routers import health as health_router
from dex.api.routers import forms as forms_router
from dex.api.routers import whatsapp_webhook as wa_webhook_router
from dex.api.routers import ifood_financial as ifood_financial_router

# Importa router do SQL Agent (pode não existir em alguns ambientes)
_SQLAGENT_IMPORT_ERR = None
try:
    from sqlagent.api.routes import router as sqlagent_router  # type: ignore
    print("[DEBUG] SQLAgent importado com sucesso.")
except Exception as _e:  # capture and log root cause
    _SQLAGENT_IMPORT_ERR = _e
    sqlagent_router = None  # type: ignore
    import traceback as _tb
    print("[WARN] Falha ao importar SQLAgent: ", repr(_e))
    print(_tb.format_exc())

print("[DEBUG] Iniciando Dex API...")

# Carrega as variáveis de ambiente
# 1) Carrega .env da pasta onde o processo é iniciado (raiz do projeto)
load_dotenv()
# 2) Carrega também backend/.env (baseado no caminho deste arquivo)
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ENV = os.path.join(_THIS_DIR, ".env")
load_dotenv(dotenv_path=_BACKEND_ENV, override=False)

# Configuração do Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

print(f"[DEBUG] SUPABASE_URL: {SUPABASE_URL if SUPABASE_URL else '[NÃO DEFINIDO]'}")
if SUPABASE_KEY:
    print(f"[DEBUG] SUPABASE_KEY: {SUPABASE_KEY[:6]}... (ocultado)")
else:
    print(f"[DEBUG] SUPABASE_KEY: [NÃO DEFINIDO]")

# Validação inicial das variáveis de ambiente
if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERRO] SUPABASE_URL e SUPABASE_KEY são obrigatórios no ambiente.")
    raise ValueError("SUPABASE_URL e SUPABASE_KEY são obrigatórios no ambiente.")
else:
    print("[DEBUG] Variáveis de ambiente carregadas com sucesso.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print("[DEBUG] Cliente Supabase inicializado.")

# Metadados reutilizados na documentação interativa (/docs e /redoc)
tags_metadata = [
    {
        "name": "Status",
        "description": (
            "Endpoints de verificação de saúde, versão e visibilidade geral da API Dex. "
            "Use antes de integrações automatizadas para checar se o deploy está ativo."
        ),
    },
    {
        "name": "Uploads",
        "description": (
            "Serviços responsáveis por receber planilhas (arquivo local ou URL) e armazenar"
            " no Supabase Storage em buckets específicos (financeiro, conciliação, etc.)."
        ),
    },
    {
        "name": "Frontend",
        "description": (
            "Rotas utilizadas pelo frontend da Dex para orquestrar uploads, registrar"
            " arquivos e iniciar fluxos internos. Ideal para times que precisam executar"
            " estas tarefas fora do monolito web."
        ),
    },
    {
        "name": "Processamento",
        "description": (
            "Orquestração de tarefas em background que processam conciliações e relatórios"
            " financeiros. Os retornos são assíncronos e atualizam o Supabase."
        ),
    },
    {
        "name": "WhatsApp",
        "description": (
            "Integração com o WhatsApp Cloud API (webhooks, envio de templates e consultas"
            " administrativas). Consulte antes de configurar novos fluxos conversacionais."
        ),
    },
    {
        "name": "SQL Agent",
        "description": (
            "Consultas estruturadas à base de dados por meio do agente SQL. Fica visível"
            " somente quando o módulo opcional é carregado durante o deploy."
        ),
    },
    {
        "name": "Forms",
        "description": (
            "Formulários simples de onboarding/diagnóstico usados em testes ou validações"
            " rápidas. Úteis para demonstrações e para ver fluxos completos sem frontend."
        ),
    },
]

# Cria a aplicação FastAPI
app = FastAPI(
    title="Dex API",
    description=(
        "Coleção oficial de serviços Dex para uploads, conciliações, integrações"
        " WhatsApp e automações SQL. Cada grupo possui documentação detalhada nas"
        " seções abaixo."
    ),
    version="1.0.0",
    contact={
        "name": "Equipe Dex",
        "email": "suporte@usa-dex.com.br",
    },
    openapi_tags=tags_metadata,
)
print("[DEBUG] FastAPI inicializado.")

# Habilita CORS para permitir que um frontend local consuma a API (ex.: Railway)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"]
)

# Inclui novos routers do módulo dex
app.include_router(health_router.router)
app.include_router(forms_router.router)
app.include_router(wa_webhook_router.router)
app.include_router(ifood_financial_router.router)
print("[DEBUG] Router iFood Financial montado: rotas /api/ifood/financial/* habilitadas.")
print("[DEBUG] Router iFood Auth desabilitado no backend Python (migrado para Supabase Functions).")
if sqlagent_router:
    app.include_router(sqlagent_router)
    print("[DEBUG] Router do SQLAgent montado: rotas /qa e /v1/sql habilitadas.")
else:
    print("[WARN] Router do SQLAgent NÃO foi montado. Motivo: ", repr(_SQLAGENT_IMPORT_ERR))

# Servir frontend estático (somente se existir)
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, '..', 'frontend'))
if os.path.isdir(_FRONTEND_DIR):
    app.mount("/frontend", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
    print(f"[DEBUG] Frontend montado em /frontend a partir de {_FRONTEND_DIR}")
else:
    print(f"[WARN] Diretório de frontend não encontrado: {_FRONTEND_DIR}. Rotas estáticas não serão montadas.")

def _ensure_unique_path(supabase_client: Client, bucket: str, user_id: str, filename: str) -> str:
    """Retorna um caminho único dentro do bucket para evitar sobrescrita.

    Se já existir um arquivo com o mesmo nome em `user_id/`, gera um nome com prefixo timestamp.
    """
    import datetime as _dt

    folder = user_id.strip("/")
    base_name = filename.strip("/")

    # Tenta listar arquivos na pasta do usuário e verificar colisão exata do nome
    try:
        entries = supabase_client.storage.from_(bucket).list(path=folder)
        existing_names = {e.get('name') for e in (entries or []) if isinstance(e, dict)}
    except Exception:
        # Se a listagem falhar por qualquer motivo, faz fallback para nome com timestamp
        existing_names = set()

    final_name = base_name
    if base_name in existing_names:
        ts = _dt.datetime.now().strftime('%Y%m%d-%H%M%S')
        # Ex.: 20250809-181010_nome.xlsx
        final_name = f"{ts}_" + base_name

    return f"{folder}/{final_name}"

@app.get("/", tags=["Status"], summary="Verifica se a API está online")
def read_root():
    """Endpoint raiz para verificar a saúde da API."""
    return {"status": "ok", "message": "Bem-vindo à Dex API!"}

@app.post("/upload/planilha", tags=["Uploads"], summary="Faz upload de uma planilha para o Supabase Storage")
async def upload_planilha(
    file: UploadFile = File(None, description="Arquivo de planilha (xlsx, csv) para upload."),
    data: UploadFile = File(None, description="Alias de arquivo (caso a ferramenta envie como 'data')."),
    user_id: str = Form(None, description="ID do usuário/conta."),
    account_id: str = Form(None, description="Alias para ID da conta (equivalente a user_id)."),
    filename: str = Form(..., description="Nome original do arquivo a ser salvo no bucket."),
    background_tasks: BackgroundTasks = None
):
    """
    Recebe um arquivo de planilha via formulário multipart e o envia para o bucket 'financeiro' no Supabase Storage.
    O caminho no bucket será estruturado como: `user_id/filename`.
    """
    try:
        bucket_name = "financeiro"
        # Gera caminho único (evita sobrescrever se já existir arquivo com mesmo nome)
        if file:
            upload_file = file
        elif data:
            upload_file = data
        else:
            raise HTTPException(status_code=400, detail="Nenhum arquivo fornecido.")

        if user_id:
            normalized_user_id = user_id
        elif account_id:
            normalized_user_id = account_id
        else:
            raise HTTPException(status_code=400, detail="Nenhum ID de usuário ou conta fornecido.")

        path_in_bucket = _ensure_unique_path(supabase, bucket_name, normalized_user_id, filename)

        # Lê o conteúdo do arquivo em bytes
        contents = await upload_file.read()

        # Faz o upload para o Supabase Storage SEM sobrescrever automaticamente
        response = supabase.storage.from_(bucket_name).upload(
            path=path_in_bucket,
            file=contents,
            file_options={"cache-control": "3600", "upsert": "false"}
        )

        # Salve o storage_path exatamente como foi salvo (pode ter prefixo de timestamp)
        storage_path = f"{bucket_name}/{path_in_bucket}"

        return JSONResponse(
            status_code=200,
            content={
                "message": "Upload realizado com sucesso!",
                "path": storage_path
            }
        )
    except Exception as e:
        # Em caso de erro, retorna uma resposta com status 500
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro no upload: {str(e)}")

# =======================
# Endpoints Frontend Aux
# =======================

@app.post("/frontend-api/upload/financeiro", tags=["Frontend"], summary="Frontend: Upload para bucket financeiro via script e cria registro")
async def frontend_upload_financeiro(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    file_id: str = Form(None)
):
    """
    Recebe arquivo do frontend, usa scripts/upload_to_bucket.py para enviar ao bucket 'financeiro',
    cria registro em received_files e retorna file_id e storage_path.
    """
    import tempfile
    try:
        # Gera file_id se não enviado
        file_id = file_id or str(uuid.uuid4())

        # Salva arquivo temporário
        suffix = os.path.splitext(file.filename or "")[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            contents = await file.read()
            tmp.write(contents)
            temp_path = tmp.name

        # Executa o script de upload
        script_path = os.path.join(os.path.dirname(__file__), 'scripts', 'upload_to_bucket.py')
        cmd = [
            sys.executable,
            script_path,
            "--filepath", temp_path,
            "--bucket-name", "financeiro",
            "--file-id", file_id,
            "--account-id", account_id,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)

        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Falha no upload: {proc.stderr.strip()}")

        # Extrai caminho do stdout do script
        stdout = proc.stdout
        # Ex.: SUCESSO: ... caminho 'ACCOUNT/FINALNAME' no bucket 'financeiro'
        m = re.search(r"caminho '([^']+)' no bucket '([^']+)'", stdout)
        if not m:
            raise HTTPException(status_code=500, detail=f"Upload ok, mas não foi possível obter o caminho salvo. STDOUT: {stdout}")
        path_in_bucket, bucket = m.group(1), m.group(2)
        storage_path = f"{bucket}/{path_in_bucket}"

        # Cria/insere registro em received_files
        record = {
            "id": file_id,
            "account_id": account_id,
            "storage_path": storage_path,
            "status": "pending",
        }
        try:
            supabase.table('received_files').insert(record).execute()
        except Exception as e:
            # Se já existir, apenas atualiza o caminho/status
            try:
                supabase.table('received_files').update({"storage_path": storage_path, "status": "pending"}).eq('id', file_id).execute()
            except Exception as e2:
                raise HTTPException(status_code=500, detail=f"Falha ao registrar arquivo no banco: {e2}")

        return {"message": "Upload financeiro realizado com sucesso.", "file_id": file_id, "storage_path": storage_path}
    finally:
        try:
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass

@app.post("/frontend-api/upload-process/conciliacao", tags=["Frontend"], summary="Frontend: Upload para conciliação e dispara processamento")
async def frontend_upload_process_conciliacao(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    account_id: str = Form(...),
    file_id: str = Form(None),
    layout_hint: str | None = Form(
        None,
        description=(
            "Opcional. Use para sinalizar manualmente o layout da planilha "
            "(ex.: 'legacy', 'v3'). Quando informado, será enviado ao pipeline "
            "de processamento para tratamento específico."
        ),
    )
):
    """
    Faz upload do arquivo para o bucket 'conciliacao', cria registro em received_files e agenda processamento.
    """
    import tempfile
    try:
        file_id = file_id or str(uuid.uuid4())

        # Valida o formato do account_id (UUID interno Dex) e verifica se existe
        try:
            account_uuid = uuid.UUID(str(account_id))
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="`account_id` inválido. Informe o UUID interno da Dex (coluna accounts.id).",
            ) from exc

        try:
            account_lookup = (
                supabase
                .table('accounts')
                .select('id')
                .eq('id', str(account_uuid))
                .limit(1)
                .execute()
            )
        except Exception as exc:
            print(f"[DEX][CONCILIACAO] Falha ao validar account_id no Supabase: {exc}")
            raise HTTPException(
                status_code=502,
                detail="Não foi possível validar o account_id no Supabase. Tente novamente em instantes ou contate o suporte.",
            ) from exc

        if not account_lookup.data:
            raise HTTPException(
                status_code=404,
                detail="Account Dex não encontrada. Confirme o UUID interno (accounts.id) e tente novamente.",
            )

        suffix = os.path.splitext(file.filename or "")[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            contents = await file.read()
            tmp.write(contents)
            temp_path = tmp.name

        # Indica nos logs qual layout o usuário informou (se houver)
        if layout_hint:
            print(f"[DEX][CONCILIACAO] layout_hint recebido: {layout_hint}")

        # Reutiliza lógica do endpoint de upload direto para Storage (sem o script), para simplicidade
        bucket_name = "conciliacao"
        # Gera caminho único
        path_in_bucket = _ensure_unique_path(supabase, bucket_name, account_id, os.path.basename(file.filename or f"{file_id}{suffix}"))
        try:
            with open(temp_path, 'rb') as fh:
                supabase.storage.from_(bucket_name).upload(
                    path=path_in_bucket,
                    file=fh.read(),
                    file_options={"cache-control": "3600", "upsert": "false"}
                )
        except Exception as exc:
            print(f"[DEX][CONCILIACAO] Falha ao enviar arquivo para o storage: {exc}")
            raise HTTPException(
                status_code=502,
                detail="Falha ao enviar arquivo ao Supabase Storage. Verifique o arquivo e tente novamente.",
            ) from exc

        storage_path = f"{bucket_name}/{path_in_bucket}"

        # Registra em received_files
        record = {
            "id": file_id,
            "account_id": str(account_uuid),
            "storage_path": storage_path,
            "status": "pending",
        }
        try:
            supabase.table('received_files').insert(record).execute()
        except Exception as exc:
            print(f"[DEX][CONCILIACAO] Falha ao inserir em received_files: {exc}")
            try:
                supabase.table('received_files').update({"storage_path": storage_path, "status": "pending"}).eq('id', file_id).execute()
            except Exception as exc_update:
                raise HTTPException(
                    status_code=502,
                    detail="Falha ao registrar arquivo em received_files. Tente novamente ou contate o suporte.",
                ) from exc_update

        # Agenda processamento usando o orquestrador existente
        background_tasks.add_task(run_processing_conciliacao, file_id, storage_path, layout_hint)

        return {"message": "Upload e processamento de conciliação agendado.", "file_id": file_id, "storage_path": storage_path}
    finally:
        try:
            if 'temp_path' in locals() and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass

import requests  # Adicionado para download de arquivos via URL
from pydantic import BaseModel
import tempfile
import os

# Importa a lógica de processamento do script
# Este endpoint é EXCLUSIVO para o processamento do relatório financeiro do iFood.
from scripts.process_report import (
    processar_relatorio_financeiro,
    init_supabase_client as init_processor_supabase,
    SupabaseLogger,
)
from scripts.process_conciliation import (
    process_conciliation_file,
    update_file_status,
)

@app.post("/upload/planilha-url", tags=["Uploads"], summary="Faz upload de uma planilha a partir de uma URL para o Supabase Storage")
async def upload_planilha_url(
    request: Request,
    file_url: str = Form(..., description="URL do arquivo de planilha (xlsx, csv) para upload."),
    user_id: str = Form(..., description="ID do usuário ou conta que está enviando o arquivo."),
    filename: str = Form(..., description="Nome original do arquivo a ser salvo no bucket."),
    tipo: str = Form(..., description="Tipo da planilha: financeiro ou conciliacao.")
):
    """
    Faz o download do arquivo da URL fornecida e envia para o bucket 'financeiro' no Supabase Storage.
    O caminho no bucket será estruturado como: `tipo/user_id/filename`, onde tipo pode ser 'financeiro' ou 'conciliacao'.
    Se o header Authorization for enviado, ele será repassado na requisição de download.
    """
    try:
        tipo = tipo.lower().strip()
        if tipo not in ["financeiro", "conciliacao"]:
            return JSONResponse(status_code=400, content={"error": "Tipo inválido. Use 'financeiro' ou 'conciliacao'."})
        bucket_name = tipo  # bucket = financeiro ou conciliacao
        # Gera caminho único para evitar sobrescrita
        path_in_bucket = _ensure_unique_path(supabase, bucket_name, user_id, filename)

        # Busca o header Authorization, se enviado
        headers = {}
        auth_header = request.headers.get("authorization")
        if auth_header:
            headers["Authorization"] = auth_header

        # Faz o download do arquivo, repassando o header Authorization se existir
        response = requests.get(file_url, headers=headers)
        response.raise_for_status()
        contents = response.content

        # Faz o upload para o Supabase Storage SEM sobrescrever automaticamente
        upload_response = supabase.storage.from_(bucket_name).upload(
            path=path_in_bucket,
            file=contents,
            file_options={"cache-control": "3600", "upsert": "false"}
        )

        # O path retornado deve ser o LÓGICO, refletindo o nome final salvo
        storage_path_for_db = f"{tipo}/{path_in_bucket}"

        return JSONResponse(
            status_code=200,
            content={
                "message": f"Upload realizado com sucesso via URL para {tipo}!",
                "path": storage_path_for_db
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

class ProcessRequest(BaseModel):
    file_id: str
    storage_path: str
    layout_hint: str | None = None

class ProcessFinanceiroRequest(BaseModel):
    file_id: str

def run_processing_financeiro(file_id: str):
    """Função que executa o processamento FINANCEIRO em background."""
    # Inicializa um cliente supabase e logger para este processo
    supabase_processor = init_processor_supabase()
    logger = SupabaseLogger(supabase_processor)

    try:
        print(f"[PRINT] Iniciando processamento para file_id: {file_id}")
        # 1. Buscar detalhes do arquivo no banco
        response = supabase_processor.table('received_files').select('storage_path, account_id').eq('id', file_id).single().execute()
        print(f"[PRINT] Resposta do select em received_files: {response}")
        record = response.data
        if not record:
            print(f"[PRINT] Registro de arquivo com ID {file_id} não encontrado.")
            logger.log("ERROR", f"Registro de arquivo com ID {file_id} não encontrado.")
            logger.flush()
            return

        storage_path = record.get('storage_path')
        account_id = record.get('account_id')
        print(f"[PRINT] storage_path do banco: {storage_path}")
        print(f"[PRINT] account_id do banco: {account_id}")
        if not storage_path:
            print(f"[PRINT] storage_path está vazio para file_id {file_id}")
            logger.log("CRITICAL", f"O campo 'storage_path' está vazio no banco para o file_id {file_id}.")
            logger.flush()
            return

        logger.log("INFO", f"[DEBUG] storage_path obtido do banco: '{storage_path}'")
        print(f"[PRINT] [DEBUG] storage_path obtido do banco: '{storage_path}'")

        # Correção para caminhos que possam começar com '/'
        clean_storage_path = storage_path.lstrip('/')
        path_parts = clean_storage_path.split('/')
        print(f"[PRINT] path_parts extraído: {path_parts}")

        if len(path_parts) < 2:
            print(f"[PRINT] storage_path '{storage_path}' é inválido (partes: {path_parts})")
            logger.log("CRITICAL", f"storage_path '{storage_path}' é inválido e não contém bucket/caminho.")
            logger.flush()
            return

        bucket_name = path_parts[0]
        path_in_bucket = '/'.join(path_parts[1:])
        print(f"[PRINT] bucket_name: {bucket_name}")
        print(f"[PRINT] path_in_bucket: {path_in_bucket}")

        logger.log("INFO", f"[DEBUG] Tentando baixar de bucket: '{bucket_name}' com o caminho: '{path_in_bucket}'")
        print(f"[PRINT] [DEBUG] Tentando baixar de bucket: '{bucket_name}' com o caminho: '{path_in_bucket}'")

        # 2. Baixar o arquivo do Supabase Storage
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp_file:
                print(f"[PRINT] Antes do download do arquivo do Storage...")
                file_content = supabase_processor.storage.from_(bucket_name).download(path=path_in_bucket)
                print(f"[PRINT] Download realizado com sucesso, tamanho: {len(file_content) if file_content else 'NULO'} bytes")
                tmp_file.write(file_content)
                temp_file_path = tmp_file.name
        except Exception as download_exc:
            print(f"[PRINT] ERRO AO BAIXAR ARQUIVO: {download_exc}")
            logger.log("CRITICAL", f"ERRO AO BAIXAR ARQUIVO: {download_exc}", context={"traceback": traceback.format_exc()})
            raise

        # 3. Chamar a função de processamento financeiro
        print(f"[PRINT] Chamando processar_relatorio_financeiro com temp_file_path: {temp_file_path}")
        processar_relatorio_financeiro(supabase_processor, logger, temp_file_path, file_id, account_id)
        print(f"[PRINT] processar_relatorio_financeiro finalizado!")

    except Exception as e:
        error_message = f"Erro no processamento em background para file_id {file_id}: {e}"
        print(f"[PRINT] {error_message}")
        logger.log("CRITICAL", error_message, context={"traceback": traceback.format_exc()})
    finally:
        # 4. Limpar o arquivo temporário e o logger
        if 'temp_file_path' in locals() and os.path.exists(temp_file_path):
            print(f"[PRINT] Removendo arquivo temporário: {temp_file_path}")
            os.remove(temp_file_path)
        logger.flush()


@app.post("/processar-planilha-financeiro", tags=["Processamento"], summary="Inicia o processamento de uma planilha FINANCEIRA em background")
async def processar_planilha_financeiro_endpoint(process_request: ProcessFinanceiroRequest, background_tasks: BackgroundTasks):
    """
    [FINANCEIRO] Recebe um `file_id` e agenda o processamento da planilha financeira correspondente em background.
    Retorna uma resposta imediata de sucesso.
    """
    background_tasks.add_task(run_processing_financeiro, process_request.file_id)
    return {"message": "Processamento da planilha financeira agendado com sucesso!", "file_id": process_request.file_id}

def run_processing_conciliacao(file_id: str, storage_path: str, layout_hint: str | None = None):
    """Função segura que executa o processamento de CONCILIAÇÃO em background."""
    supabase_processor = None
    logger = None
    temp_file_path = None

    try:
        print(f"[CONCILIATION_TASK] Iniciando para file_id: {file_id}")
        supabase_processor = init_processor_supabase()
        logger = SupabaseLogger(supabase_processor)
        print(f"[CONCILIATION_TASK] Logger inicializado. Buscando account_id...")

        # Busca o ID da conta associado ao arquivo.
        response = supabase_processor.table('received_files').select('account_id').eq('id', file_id).single().execute()
        if not response.data or not response.data.get('account_id'):
            print(f"[CONCILIATION_TASK] ERRO: account_id não encontrado para file_id {file_id}. Resposta: {response.data}")
            raise ValueError(f"Metadados (account_id) para file_id {file_id} não encontrados.")
        account_id = response.data['account_id']
        print(f"[CONCILIATION_TASK] account_id {account_id} encontrado com sucesso.")

        logger.set_context(file_id=file_id, account_id=account_id)

        # Faz o download do arquivo para um local temporário
        logger.log('INFO', f'Iniciando download do arquivo de conciliação: {storage_path}')
        if layout_hint:
            logger.log('INFO', f'Layout hint recebido: {layout_hint}')
        print(f"[CONCILIATION_TASK] Preparando para download. Storage path: {storage_path}")
        path_parts = storage_path.lstrip('/').split('/')
        bucket_name = path_parts[0]
        path_in_bucket = '/'.join(path_parts[1:])
        print(f"[CONCILIATION_TASK] Tentando download do bucket: '{bucket_name}', path: '{path_in_bucket}'")
        
        file_content = supabase_processor.storage.from_(bucket_name).download(path=path_in_bucket)
        print(f"[CONCILIATION_TASK] Download concluído. Bytes recebidos: {len(file_content) if file_content else '0'}")
        
        # Detectar extensão correta do arquivo
        import os
        file_extension = os.path.splitext(path_in_bucket)[1] or '.csv'
        print(f"[CONCILIATION_TASK] Extensão detectada: {file_extension}")
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as tmp_file:
            tmp_file.write(file_content)
            temp_file_path = tmp_file.name
        del file_content
        logger.log('INFO', f'Arquivo salvo temporariamente em: {temp_file_path}')

        # Chama diretamente a função de processamento, que agora faz parte da mesma aplicação
        update_file_status(logger, supabase_processor, file_id, 'processing')
        logger.log('INFO', 'Iniciando a execução direta da função de processamento de conciliação.')

        process_conciliation_file(
            logger=logger,
            supabase_client=supabase_processor,
            file_path=temp_file_path,
            file_id=file_id,
            account_id=account_id,
            layout_hint=layout_hint,
        )

        logger.log('INFO', 'Função de processamento de conciliação concluída com sucesso.')

    except Exception as e:
        error_message = f"Erro no orquestrador de processamento de conciliação: {e}"
        tb_str = traceback.format_exc()
        if logger:
            logger.log('CRITICAL', error_message, context={"traceback": tb_str})
            update_file_status(logger, supabase_processor, file_id, 'error', error_message)
        else:
            print(f"ERRO CRÍTICO (logger indisponível): {error_message}", file=sys.stderr)
            print(tb_str, file=sys.stderr)
            
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
            print(f"INFO: Arquivo temporário {temp_file_path} removido.")
        if logger:
            logger.flush()

@app.post("/processar-planilha-conciliacao", tags=["Processamento"], summary="Inicia o processamento de uma planilha de CONCILIAÇÃO em background")
async def processar_planilha_conciliacao_endpoint(process_request: ProcessRequest, background_tasks: BackgroundTasks):
    """
    [CONCILIAÇÃO] Recebe um `file_id` e agenda o processamento da planilha de conciliação correspondente em background.
    Retorna uma resposta imediata de sucesso.
    """
    background_tasks.add_task(
        run_processing_conciliacao,
        process_request.file_id,
        process_request.storage_path,
        process_request.layout_hint,
    )
    return {"message": "Processamento da planilha de conciliação agendado com sucesso!", "file_id": process_request.file_id}
