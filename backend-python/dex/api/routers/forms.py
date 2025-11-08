from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse
from ...infra.supabase import get_supabase
import logging
import traceback

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Forms"], prefix="/forms")


@router.get("/signup", response_class=HTMLResponse, summary="Formulário simples de cadastro (teste)")
def signup_form():
    return """
    <html>
      <head><title>Cadastro Dex (Teste)</title></head>
      <body style="font-family: sans-serif; max-width: 640px; margin: 2rem auto;">
        <h2>Cadastro Dex (Teste)</h2>
        <form method="post" action="/forms/signup">
          <label>Nome:<br/><input name="name" required></label><br/><br/>
          <label>WhatsApp (com DDI):<br/>
            <input name="whatsapp" value="+55" placeholder="+55DDD9XXXXXXXX" title="Use +55 seguido do DDD e o número com 9 dígitos" required>
          </label>
          <div style="color:#555; font-size: 0.9rem; margin-top: 0.25rem;">Formato esperado: <b>+55</b> + <b>DDD</b> + <b>número com 9 dígitos</b>. Ex.: +5511999999999</div>
          <br/>
          <button type="submit">Criar conta de teste</button>
        </form>
      </body>
    </html>
    """


@router.post("/signup", summary="Cria conta + usuário owner (teste)")
def signup_create(request: Request, name: str = Form(...), whatsapp: str = Form(...)):
    sb = get_supabase()
    
    try:
        # Validação básica
        whatsapp = whatsapp.strip()
        if not whatsapp.startswith('+55') or not whatsapp[1:].isdigit() or len(whatsapp) < 13:
            return JSONResponse(
                status_code=400,
                content={"error": "WhatsApp inválido", "expected": "+55DDD9XXXXXXXX"}
            )

        # Cria conta via PostgREST
        acc_insert = sb.table('accounts').insert({}).select('id').single().execute()
        if not acc_insert.data or 'id' not in acc_insert.data:
            raise RuntimeError(f"Falha ao criar conta: resposta inválida {acc_insert}")
        account_id = acc_insert.data['id']

        # Cria usuário owner vinculado
        user_payload = {
            'account_id': account_id,
            'user_name': name,
            'whatsapp_number': whatsapp,
            'role': 'owner',
        }
        user_insert = sb.table('users').insert(user_payload).select('id').single().execute()
        if not user_insert.data or 'id' not in user_insert.data:
            raise RuntimeError(f"Falha ao criar usuário: resposta inválida {user_insert}")

        return JSONResponse(
            status_code=200,
            content={
                "account_id": account_id,
                "user_id": user_insert.data['id']
            }
        )

    except Exception as e:
        logger.exception("Erro no cadastro via formulário")
        return JSONResponse(status_code=500, content={"error": "Erro no cadastro", "details": str(e)})


@router.get("/upload", response_class=HTMLResponse, summary="Form simples para envio da conciliação")
def upload_form():
    return """
    <html>
      <head><title>Upload Conciliação (Teste)</title></head>
      <body style="font-family: sans-serif; max-width: 640px; margin: 2rem auto;">
        <h2>Upload de Conciliação (Teste)</h2>
        <form method="post" action="/frontend/upload-process/conciliacao" enctype="multipart/form-data">
          <label>Account ID:<br/><input name="account_id" required></label><br/><br/>
          <label>Arquivo (.xlsx):<br/><input type="file" name="file" accept=".xlsx" required></label><br/><br/>
          <button type="submit">Enviar e Processar</button>
        </form>
        <p style="margin-top:1rem;color:#444">Dica: crie uma conta em <a href="/forms/signup">/forms/signup</a> e use o account_id retornado aqui.</p>
      </body>
    </html>
    """
