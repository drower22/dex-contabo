# Guia de Deploy - Backend Contabo

## Variáveis de Ambiente Necessárias

Para que os endpoints de autenticação iFood funcionem, você precisa configurar as seguintes variáveis de ambiente no servidor Contabo:

### 1. Credenciais Supabase
```bash
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=seu_service_role_key_aqui
```

### 2. Credenciais iFood (Reviews)
```bash
IFOOD_CLIENT_ID_REVIEWS=seu_client_id_reviews
IFOOD_CLIENT_SECRET_REVIEWS=seu_client_secret_reviews
```

### 3. Credenciais iFood (Financial)
```bash
IFOOD_CLIENT_ID_FINANCIAL=seu_client_id_financial
IFOOD_CLIENT_SECRET_FINANCIAL=seu_client_secret_financial
```

### 4. Chave de Criptografia
```bash
# Gerar uma chave de 64 caracteres hexadecimais (32 bytes)
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

### 5. Configurações Adicionais
```bash
IFOOD_API_URL=https://merchant-api.ifood.com.br
CORS_ORIGIN=https://dex-parceiros-api-ifood.vercel.app
```

## Como Configurar no Contabo

### Opção 1: Arquivo .env
1. SSH no servidor Contabo
2. Navegue até o diretório do projeto
3. Crie/edite o arquivo `.env`:
```bash
cd /caminho/para/dex-contabo
nano .env
```
4. Cole as variáveis acima
5. Reinicie o serviço

### Opção 2: Variáveis de Sistema
```bash
# Adicionar ao ~/.bashrc ou /etc/environment
export SUPABASE_URL="..."
export SUPABASE_SERVICE_ROLE_KEY="..."
# ... etc
```

## Estrutura dos Endpoints

### POST /api/ifood-auth/link
Gera código de vínculo (device authorization flow)

**Query params:**
- `scope` (opcional): `reviews` ou `financial`

**Body:**
```json
{
  "storeId": "uuid-da-conta",
  "merchantId": "merchant-id-ifood"
}
```

**Response:**
```json
{
  "userCode": "ABCD-1234",
  "authorizationCodeVerifier": "...",
  "verificationUrl": "https://portal.ifood.com.br/apps/code",
  "verificationUrlComplete": "https://portal.ifood.com.br/apps/code?user_code=ABCD-1234"
}
```

### POST /api/ifood-auth/exchange
Troca authorization code por tokens

**Query params:**
- `scope` (opcional): `reviews` ou `financial`

**Body:**
```json
{
  "storeId": "uuid-da-conta",
  "authorizationCode": "codigo-do-portal",
  "authorizationCodeVerifier": "verifier-do-link"
}
```

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

### POST /api/ifood-auth/refresh
Renova access token

**Query params:**
- `scope` (opcional): `reviews` ou `financial`

**Body:**
```json
{
  "storeId": "uuid-da-conta"
}
```

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

### GET /api/ifood-auth/status
Verifica status da conexão

**Query params:**
- `accountId`: UUID da conta
- `scope`: `reviews` ou `financial`

**Response:**
```json
{
  "status": "connected|pending|error",
  "merchantId": "merchant-id-ifood"
}
```

## Segurança

- ✅ Tokens são criptografados com AES-256-CBC antes de salvar no banco
- ✅ CORS configurado para aceitar apenas domínios autorizados
- ✅ Validação de parâmetros em todos os endpoints
- ✅ Service Role Key do Supabase nunca exposta ao frontend

## Troubleshooting

### Erro: "iFood credentials not configured"
- Verifique se as variáveis `IFOOD_CLIENT_ID_*` e `IFOOD_CLIENT_SECRET_*` estão definidas
- Reinicie o serviço após adicionar variáveis

### Erro: "Invalid ENCRYPTION_KEY"
- A chave deve ter exatamente 64 caracteres hexadecimais
- Gere uma nova: `openssl rand -hex 32`

### Erro: "Failed to exchange authorization code"
- Verifique se o código não expirou (válido por ~10 minutos)
- Confirme que o `authorizationCodeVerifier` está correto
- Verifique se as credenciais do iFood estão corretas

## Deploy

Após configurar as variáveis:

```bash
# Fazer pull das alterações
cd /caminho/para/dex-contabo
git pull origin main

# Instalar dependências (se necessário)
npm install

# Reiniciar serviço
pm2 restart dex-api
# ou
systemctl restart dex-api
```
