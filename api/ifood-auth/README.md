# 🔐 iFood Authentication API

API de autenticação distribuída do iFood seguindo o padrão OAuth 2.0.

## 📚 Documentação Oficial

- [Guia de Autenticação](https://developer.ifood.com.br/pt-BR/docs/guides/authentication)
- [Fluxo Distribuído](https://developer.ifood.com.br/pt-BR/docs/guides/authentication/distributed)
- [Merchant Workflow](https://developer.ifood.com.br/pt-BR/docs/guides/merchant/workflow)

## 🎯 Endpoints

### 1. POST `/api/ifood-auth/link`
Solicita código de vínculo (userCode) para iniciar o fluxo OAuth.

**Request:**
```json
{
  "scope": "reviews",
  "storeId": "uuid-da-conta"
}
```

**Response:**
```json
{
  "userCode": "ABC123",
  "authorizationCodeVerifier": "verifier_xyz...",
  "verificationUrl": "https://portal.ifood.com.br/...",
  "expiresIn": 600
}
```

**Processo:**
1. Chama API iFood para obter userCode
2. Salva link_code e verifier no Supabase
3. Retorna dados para o usuário autorizar no Portal

---

### 2. POST `/api/ifood-auth/exchange`
Troca authorizationCode por access_token e refresh_token.

**Request:**
```json
{
  "scope": "reviews",
  "storeId": "uuid-da-conta",
  "authorizationCode": "codigo-do-portal",
  "authorizationCodeVerifier": "verifier_xyz..."
}
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

**Processo:**
1. Resolve account_id interno
2. Chama API iFood com grantType=authorization_code
3. Extrai merchantId (3 métodos de fallback)
4. Criptografa tokens com AES-GCM
5. Salva no Supabase com status 'connected'
6. Atualiza accounts.ifood_merchant_id

---

### 3. POST `/api/ifood-auth/refresh`
Renova access_token usando refresh_token.

**Request:**
```json
{
  "scope": "reviews",
  "storeId": "merchant-id-ou-uuid"
}
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

**Processo:**
1. Busca conta e tokens no Supabase
2. **Otimização:** Se token válido por >120s, retorna sem chamar API
3. Descriptografa refresh_token
4. Chama API iFood com grantType=refresh_token
5. Criptografa novos tokens
6. Atualiza no Supabase

---

### 4. GET `/api/ifood-auth/status`
Valida status da autenticação chamando API real do iFood.

**Request:**
```
GET /api/ifood-auth/status?accountId=uuid&scope=reviews
```

**Response:**
```json
{
  "status": "connected",
  "message": "Token validated successfully with iFood API",
  "merchantId": "merchant-id"
}
```

**Status Possíveis:**
- `connected`: Token válido
- `pending`: Não autenticado ou token expirado
- `error`: Erro de validação

**Processo:**
1. Busca access_token no Supabase
2. Descriptografa token
3. Chama GET /merchant/v1.0/merchants/me
4. Atualiza status baseado na resposta

---

## 🔧 Variáveis de Ambiente

### Obrigatórias

```env
# Supabase
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# iFood (opção 1: credenciais únicas)
IFOOD_CLIENT_ID=seu-client-id
IFOOD_CLIENT_SECRET=seu-client-secret

# Criptografia (32 bytes em base64)
ENCRYPTION_KEY=base64-encoded-key
```

### Opcionais

```env
# iFood (opção 2: credenciais por escopo)
IFOOD_CLIENT_ID_REVIEWS=client-id-reviews
IFOOD_CLIENT_SECRET_REVIEWS=client-secret-reviews
IFOOD_CLIENT_ID_FINANCIAL=client-id-financial
IFOOD_CLIENT_SECRET_FINANCIAL=client-secret-financial

# Configurações
IFOOD_BASE_URL=https://merchant-api.ifood.com.br
CORS_ORIGIN=https://seu-frontend.vercel.app
```

### Gerar ENCRYPTION_KEY

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# OpenSSL
openssl rand -base64 32
```

---

## 🗄️ Schema Supabase

```sql
create table public.ifood_store_auth (
  id uuid not null default gen_random_uuid(),
  account_id text not null,
  ifood_merchant_id text null,
  link_code text null,
  verifier text null,
  access_token text null,
  refresh_token text null,
  expires_at timestamp with time zone null,
  status text not null default 'pending',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  scope text not null,
  
  constraint ifood_store_auth_pkey primary key (id),
  constraint ifood_store_auth_account_id_scope_uix unique (account_id, scope),
  constraint ifood_store_auth_scope_chk check (scope = any (array['reviews', 'financial'])),
  constraint ifood_store_auth_status_chk check (status = any (array['pending', 'connected', 'error']))
);

create index ifood_store_auth_merchant_idx on public.ifood_store_auth (ifood_merchant_id);
create index idx_ifood_store_auth_store on public.ifood_store_auth (account_id);
create trigger trg_ifood_store_auth_updated before update on ifood_store_auth 
  for each row execute function set_updated_at();
```

---

## 🔄 Fluxo Completo

```mermaid
sequenceDiagram
    participant F as Frontend
    participant A as API
    participant I as iFood API
    participant P as Portal Parceiro
    participant S as Supabase

    F->>A: POST /link {scope, storeId}
    A->>I: POST /oauth/userCode
    I-->>A: {userCode, verifier}
    A->>S: Save link_code, verifier
    A-->>F: {userCode, verificationUrl}
    
    F->>P: User autoriza com userCode
    P-->>F: authorizationCode
    
    F->>A: POST /exchange {authCode, verifier}
    A->>I: POST /oauth/token (authorization_code)
    I-->>A: {accessToken, refreshToken}
    A->>I: GET /merchants/me (extract merchantId)
    A->>S: Save encrypted tokens, merchantId
    A->>S: Update accounts.ifood_merchant_id
    A-->>F: {access_token, refresh_token}
    
    F->>A: GET /status?accountId&scope
    A->>S: Get access_token
    A->>I: GET /merchants/me (validate)
    I-->>A: 200 OK
    A->>S: Update status=connected
    A-->>F: {status: "connected"}
    
    F->>A: POST /refresh {scope, storeId}
    A->>S: Get refresh_token
    A->>I: POST /oauth/token (refresh_token)
    I-->>A: {new accessToken, refreshToken}
    A->>S: Update encrypted tokens
    A-->>F: {access_token, refresh_token}
```

---

## 🧪 Testes

### Script Bash Interativo
```bash
./test-ifood-auth.sh https://seu-backend.railway.app uuid-da-conta reviews
```

### Queries SQL
Execute as queries em `test-ifood-auth.sql` no Supabase SQL Editor.

### Teste Manual com cURL

#### 1. Link
```bash
curl -X POST https://seu-backend/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"uuid"}'
```

#### 2. Exchange
```bash
curl -X POST https://seu-backend/api/ifood-auth/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "scope":"reviews",
    "storeId":"uuid",
    "authorizationCode":"ABC123",
    "authorizationCodeVerifier":"verifier"
  }'
```

#### 3. Status
```bash
curl "https://seu-backend/api/ifood-auth/status?accountId=uuid&scope=reviews"
```

#### 4. Refresh
```bash
curl -X POST https://seu-backend/api/ifood-auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"merchant-id"}'
```

---

## 🔒 Segurança

### Criptografia
- **Algoritmo:** AES-GCM (256 bits)
- **IV:** 12 bytes aleatórios por token
- **Formato:** Base64(IV + ciphertext)

### Boas Práticas
- ✅ Tokens nunca armazenados em plaintext
- ✅ Service role key nunca exposta no frontend
- ✅ CORS configurado para domínios específicos
- ✅ Validação de entrada em todos os endpoints
- ✅ Logs não expõem tokens sensíveis

### Checklist de Segurança
- [ ] ENCRYPTION_KEY gerada aleatoriamente
- [ ] ENCRYPTION_KEY diferente em prod/dev
- [ ] SUPABASE_SERVICE_ROLE_KEY protegida
- [ ] CORS_ORIGIN configurado corretamente
- [ ] HTTPS obrigatório em produção
- [ ] Rate limiting implementado (recomendado)

---

## 🐛 Troubleshooting

### Erro: "Missing ENCRYPTION_KEY"
**Causa:** Variável de ambiente não configurada.
**Solução:** Gere e configure ENCRYPTION_KEY.

### Erro: "Decryption failed"
**Causa:** ENCRYPTION_KEY mudou ou token corrompido.
**Solução:** Re-autentique a conta (novo fluxo link→exchange).

### Erro: "Conta não encontrada"
**Causa:** storeId inválido ou conta não existe.
**Solução:** Verifique UUID na tabela accounts.

### Erro: "Token expired or revoked"
**Causa:** Token expirado ou revogado pelo iFood.
**Solução:** Use /refresh ou re-autentique.

### Erro: "iFood API returned 401"
**Causa:** Credenciais inválidas ou token expirado.
**Solução:** Verifique CLIENT_ID/SECRET ou use refresh.

### Status sempre "pending"
**Causa:** Exchange não foi executado ou falhou.
**Solução:** Verifique logs do exchange e tente novamente.

---

## 📊 Monitoramento

### Queries Úteis

**Contas conectadas:**
```sql
SELECT COUNT(*) FROM ifood_store_auth 
WHERE status = 'connected' AND expires_at > NOW();
```

**Tokens expirando em breve:**
```sql
SELECT account_id, scope, expires_at 
FROM ifood_store_auth
WHERE expires_at < NOW() + INTERVAL '10 minutes'
  AND expires_at > NOW();
```

**Taxa de sucesso por escopo:**
```sql
SELECT 
  scope,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'connected') as conectadas,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'connected') / COUNT(*), 2) as taxa_sucesso
FROM ifood_store_auth
GROUP BY scope;
```

---

## 🚀 Deploy

### Vercel
1. Configure variáveis de ambiente no dashboard
2. Deploy automático via GitHub
3. Rotas serverless criadas automaticamente

### Railway
1. Configure variáveis de ambiente
2. Deploy via GitHub ou CLI
3. Endpoints disponíveis em `https://seu-app.railway.app`

### Validação Pós-Deploy
```bash
# Health check
curl https://seu-backend/

# Teste link (não requer autenticação prévia)
curl -X POST https://seu-backend/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"uuid-valido"}'
```

---

## 📝 Changelog

### v1.0.0 (2025-01-03)
- ✅ Implementação completa do fluxo distribuído
- ✅ Suporte a múltiplos escopos (reviews, financial)
- ✅ Criptografia AES-GCM para tokens
- ✅ Validação real via API iFood
- ✅ Otimização de refresh (reutiliza tokens válidos)
- ✅ Extração robusta de merchantId (3 fallbacks)
- ✅ Documentação completa

---

## 🤝 Contribuindo

1. Siga o padrão de código existente
2. Adicione testes para novos recursos
3. Atualize a documentação
4. Não commite credenciais ou tokens

---

## 📞 Suporte

- **Documentação iFood:** https://developer.ifood.com.br/support
- **Equipe Dex:** suporte@usa-dex.com.br

---

**Última atualização:** 2025-01-03  
**Versão:** 1.0.0
