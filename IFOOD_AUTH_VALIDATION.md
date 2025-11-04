# 🔐 Validação do Fluxo de Autenticação iFood - Análise Completa

## 📋 Índice
1. [Visão Geral](#visão-geral)
2. [Estrutura Atual](#estrutura-atual)
3. [Fluxo de Autenticação Distribuída](#fluxo-de-autenticação-distribuída)
4. [Tabela Supabase](#tabela-supabase)
5. [Endpoints Implementados](#endpoints-implementados)
6. [Validação Passo a Passo](#validação-passo-a-passo)
7. [Checklist de Testes](#checklist-de-testes)
8. [Problemas Identificados e Soluções](#problemas-identificados-e-soluções)

---

## 🎯 Visão Geral

O sistema implementa o **fluxo de autenticação distribuída** do iFood conforme documentação oficial:
- https://developer.ifood.com.br/pt-BR/docs/guides/authentication/distributed

### Características do Fluxo Distribuído
- ✅ Aplicativos públicos e acessíveis pela internet
- ✅ Requer autorização explícita do proprietário da loja
- ✅ Suporta múltiplos escopos (reviews e financial)
- ✅ Tokens criptografados com AES-GCM
- ✅ Refresh automático de tokens

---

## 🏗️ Estrutura Atual

### Arquivos de Autenticação
```
dex-contabo/api/ifood-auth/
├── link.ts          # Passo 1: Solicita código de vínculo (userCode)
├── exchange.ts      # Passo 2: Troca authorizationCode por tokens
├── refresh.ts       # Passo 3: Renova access_token usando refresh_token
└── status.ts        # Validação: Verifica status da autenticação
```

### Módulo de Criptografia
```
dex-contabo/api/_shared/
└── crypto.ts        # AES-GCM encryption/decryption
```

---

## 🔄 Fluxo de Autenticação Distribuída

### Passo 1: Solicitar Código de Vínculo
**Endpoint:** `POST /api/ifood-auth/link`

**Request:**
```json
{
  "scope": "reviews",  // ou "financial"
  "storeId": "uuid-da-conta",
  "merchantId": "merchant-id-ifood" // opcional
}
```

**Processo:**
1. Chama API iFood: `POST /authentication/v1.0/oauth/userCode`
2. Recebe `userCode` e `authorizationCodeVerifier`
3. Salva em `ifood_store_auth` com status `pending`

**Response:**
```json
{
  "userCode": "ABC123",
  "authorizationCodeVerifier": "verifier_xyz...",
  "verificationUrl": "https://portal.ifood.com.br/...",
  "expiresIn": 600
}
```

**Variáveis de Ambiente Usadas:**
- `IFOOD_CLIENT_ID` ou `IFOOD_CLIENT_ID_REVIEWS` ou `IFOOD_CLIENT_ID_FINANCIAL`
- `IFOOD_BASE_URL` (default: https://merchant-api.ifood.com.br)

---

### Passo 2: Trocar Código por Tokens
**Endpoint:** `POST /api/ifood-auth/exchange`

**Request:**
```json
{
  "scope": "reviews",
  "storeId": "uuid-da-conta",
  "authorizationCode": "codigo-fornecido-pelo-usuario",
  "authorizationCodeVerifier": "verifier_xyz..."
}
```

**Processo:**
1. Resolve `account_id` interno (via storeId ou merchantId)
2. Chama API iFood: `POST /authentication/v1.0/oauth/token`
   - `grantType: authorization_code`
   - `clientId` + `clientSecret`
   - `authorizationCode` + `authorizationCodeVerifier`
3. Recebe `accessToken`, `refreshToken`, `expiresIn`
4. Tenta extrair `merchantId` de 3 formas:
   - Do response direto (`merchantId`, `merchant_id`, etc)
   - Chamando `/merchant/v1.0/merchants/me`
   - Decodificando JWT (claim `merchant_scope`)
5. Criptografa tokens com AES-GCM
6. Salva em `ifood_store_auth` com status `connected`
7. Atualiza `accounts.ifood_merchant_id`

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

**Variáveis de Ambiente Usadas:**
- `IFOOD_CLIENT_ID_[SCOPE]` ou `IFOOD_CLIENT_ID`
- `IFOOD_CLIENT_SECRET_[SCOPE]` ou `IFOOD_CLIENT_SECRET`
- `ENCRYPTION_KEY` (32 bytes em base64)

---

### Passo 3: Renovar Token
**Endpoint:** `POST /api/ifood-auth/refresh`

**Request:**
```json
{
  "scope": "reviews",
  "storeId": "merchant-id-ifood"  // ou UUID interno
}
```

**Processo:**
1. Busca conta por `ifood_merchant_id` ou `accounts.id`
2. Busca token no escopo solicitado (com fallback para escopo oposto)
3. **Otimização:** Se token atual válido por >120s, retorna sem chamar API
4. Descriptografa `refresh_token`
5. Chama API iFood: `POST /authentication/v1.0/oauth/token`
   - `grantType: refresh_token`
   - `clientId` + `clientSecret`
   - `refreshToken`
6. Criptografa novos tokens
7. Atualiza `ifood_store_auth` com status `connected`

**Response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

---

### Validação de Status
**Endpoint:** `GET /api/ifood-auth/status?accountId=xxx&scope=reviews`

**Processo:**
1. Busca registro em `ifood_store_auth`
2. Descriptografa `access_token`
3. **Validação REAL:** Chama `GET /merchant/v1.0/merchants/me` com o token
4. Atualiza status baseado na resposta:
   - `200 OK` → `connected`
   - `401/403` → `pending` (expirado/revogado)
   - Outros → `error`

**Response:**
```json
{
  "status": "connected",
  "message": "Token validated successfully with iFood API",
  "merchantId": "merchant-id"
}
```

---

## 🗄️ Tabela Supabase

### Schema: `ifood_store_auth`

```sql
create table public.ifood_store_auth (
  id uuid not null default gen_random_uuid(),
  account_id text not null,                    -- UUID interno da conta
  ifood_merchant_id text null,                  -- ID do merchant no iFood
  link_code text null,                          -- userCode temporário
  verifier text null,                           -- authorizationCodeVerifier
  access_token text null,                       -- Token criptografado (AES-GCM)
  refresh_token text null,                      -- Refresh token criptografado
  expires_at timestamp with time zone null,     -- Data de expiração
  status text not null default 'pending',       -- pending | connected | error
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  scope text not null,                          -- reviews | financial
  
  constraint ifood_store_auth_pkey primary key (id),
  constraint ifood_store_auth_account_id_scope_uix unique (account_id, scope),
  constraint ifood_store_auth_scope_chk check (scope = any (array['reviews', 'financial'])),
  constraint ifood_store_auth_status_chk check (status = any (array['pending', 'connected', 'error']))
);

-- Índices
create index ifood_store_auth_merchant_idx on public.ifood_store_auth (ifood_merchant_id);
create index idx_ifood_store_auth_store on public.ifood_store_auth (account_id);

-- Trigger para updated_at
create trigger trg_ifood_store_auth_updated 
  before update on ifood_store_auth 
  for each row execute function set_updated_at();
```

### Campos Importantes

| Campo | Tipo | Descrição | Quando é Preenchido |
|-------|------|-----------|---------------------|
| `account_id` | text | UUID interno da Dex | Sempre (obrigatório) |
| `scope` | text | reviews ou financial | Sempre (obrigatório) |
| `link_code` | text | Código de vínculo | Passo 1 (link) |
| `verifier` | text | Verificador PKCE | Passo 1 (link) |
| `access_token` | text | Token criptografado | Passo 2 (exchange) |
| `refresh_token` | text | Refresh criptografado | Passo 2 (exchange) |
| `expires_at` | timestamp | Expiração do token | Passo 2 (exchange) |
| `ifood_merchant_id` | text | ID do merchant iFood | Passo 2 (exchange) |
| `status` | text | pending/connected/error | Todos os passos |

---

## 🔌 Endpoints Implementados

### 1. Link (Solicitar Código)
```bash
POST /api/ifood-auth/link
Content-Type: application/json

{
  "scope": "reviews",
  "storeId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 2. Exchange (Trocar Código)
```bash
POST /api/ifood-auth/exchange
Content-Type: application/json

{
  "scope": "reviews",
  "storeId": "550e8400-e29b-41d4-a716-446655440000",
  "authorizationCode": "ABC123XYZ",
  "authorizationCodeVerifier": "verifier_from_link_step"
}
```

### 3. Refresh (Renovar Token)
```bash
POST /api/ifood-auth/refresh
Content-Type: application/json

{
  "scope": "reviews",
  "storeId": "merchant-id-ifood-ou-uuid-interno"
}
```

### 4. Status (Validar)
```bash
GET /api/ifood-auth/status?accountId=550e8400-e29b-41d4-a716-446655440000&scope=reviews
```

---

## ✅ Validação Passo a Passo

### Preparação

#### 1. Verificar Variáveis de Ambiente
```bash
# Obrigatórias
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# iFood (pelo menos uma das opções)
IFOOD_CLIENT_ID=seu-client-id
IFOOD_CLIENT_SECRET=seu-client-secret

# Ou separado por escopo
IFOOD_CLIENT_ID_REVIEWS=client-id-reviews
IFOOD_CLIENT_SECRET_REVIEWS=client-secret-reviews
IFOOD_CLIENT_ID_FINANCIAL=client-id-financial
IFOOD_CLIENT_SECRET_FINANCIAL=client-secret-financial

# Criptografia (32 bytes em base64)
ENCRYPTION_KEY=base64-encoded-32-bytes-key

# Opcional
IFOOD_BASE_URL=https://merchant-api.ifood.com.br
CORS_ORIGIN=https://seu-frontend.vercel.app
```

#### 2. Gerar ENCRYPTION_KEY
```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# OpenSSL
openssl rand -base64 32
```

#### 3. Verificar Conta no Supabase
```sql
-- Verificar se a conta existe
SELECT id, ifood_merchant_id, name 
FROM accounts 
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

-- Verificar registros de autenticação existentes
SELECT * 
FROM ifood_store_auth 
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000';
```

---

### Teste 1: Fluxo Completo - Reviews

#### 1.1. Solicitar Código de Vínculo
```bash
curl -X POST https://seu-backend.railway.app/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Resultado Esperado:**
```json
{
  "userCode": "ABC123",
  "authorizationCodeVerifier": "verifier_xyz...",
  "verificationUrl": "https://portal.ifood.com.br/...",
  "expiresIn": 600
}
```

**Validação no Banco:**
```sql
SELECT link_code, verifier, status, scope
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';
```

Deve retornar:
- `link_code`: "ABC123"
- `verifier`: "verifier_xyz..."
- `status`: "pending"
- `scope`: "reviews"

---

#### 1.2. Autorizar no Portal do Parceiro

1. Acesse: https://portal.ifood.com.br/
2. Faça login como proprietário da loja
3. Navegue até: Integrações → Autorizar Aplicativo
4. Digite o código: **ABC123**
5. Autorize o acesso
6. Copie o **código de autorização** fornecido

---

#### 1.3. Trocar Código por Tokens
```bash
curl -X POST https://seu-backend.railway.app/api/ifood-auth/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "550e8400-e29b-41d4-a716-446655440000",
    "authorizationCode": "CODIGO_FORNECIDO_PELO_PORTAL",
    "authorizationCodeVerifier": "verifier_xyz..."
  }'
```

**Resultado Esperado:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

**Validação no Banco:**
```sql
SELECT 
  status, 
  ifood_merchant_id,
  expires_at,
  length(access_token) as token_length,
  length(refresh_token) as refresh_length
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';
```

Deve retornar:
- `status`: "connected"
- `ifood_merchant_id`: "merchant-id-real"
- `expires_at`: timestamp futuro (~1h)
- `token_length`: >100 (token criptografado em base64)
- `refresh_length`: >100

**Validação na Tabela Accounts:**
```sql
SELECT ifood_merchant_id 
FROM accounts 
WHERE id = '550e8400-e29b-41d4-a716-446655440000';
```

Deve ter sido atualizado com o merchantId do iFood.

---

#### 1.4. Validar Status
```bash
curl "https://seu-backend.railway.app/api/ifood-auth/status?accountId=550e8400-e29b-41d4-a716-446655440000&scope=reviews"
```

**Resultado Esperado:**
```json
{
  "status": "connected",
  "message": "Token validated successfully with iFood API",
  "merchantId": "merchant-id-real"
}
```

---

#### 1.5. Testar Refresh
```bash
curl -X POST https://seu-backend.railway.app/api/ifood-auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "merchant-id-real"
  }'
```

**Resultado Esperado:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

**Nota:** Se o token ainda for válido por >120s, retorna o token atual sem chamar a API do iFood.

---

### Teste 2: Fluxo Completo - Financial

Repita os passos 1.1 a 1.5, substituindo `"scope": "reviews"` por `"scope": "financial"`.

**Importante:** 
- Use credenciais diferentes se tiver apps separados
- Verifique se `IFOOD_CLIENT_ID_FINANCIAL` e `IFOOD_CLIENT_SECRET_FINANCIAL` estão configurados

---

### Teste 3: Cenários de Erro

#### 3.1. Token Expirado
```bash
# 1. Force a expiração no banco
UPDATE ifood_store_auth 
SET expires_at = NOW() - INTERVAL '1 hour'
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';

# 2. Teste o status
curl "https://seu-backend.railway.app/api/ifood-auth/status?accountId=550e8400-e29b-41d4-a716-446655440000&scope=reviews"
```

**Resultado Esperado:**
```json
{
  "status": "pending",
  "message": "Token expired or revoked. Please reconnect.",
  "httpStatus": 401
}
```

#### 3.2. Refresh com Token Expirado
```bash
curl -X POST https://seu-backend.railway.app/api/ifood-auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "merchant-id-real"
  }'
```

**Resultado Esperado:**
- Se refresh_token válido: novos tokens
- Se refresh_token expirado: erro 401/403 do iFood

---

#### 3.3. Conta Não Encontrada
```bash
curl -X POST https://seu-backend.railway.app/api/ifood-auth/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "00000000-0000-0000-0000-000000000000",
    "authorizationCode": "ABC",
    "authorizationCodeVerifier": "XYZ"
  }'
```

**Resultado Esperado:**
```json
{
  "error": "Conta não encontrada para o storeId/merchantId informado."
}
```

---

#### 3.4. Credenciais Inválidas
```bash
# Remova temporariamente IFOOD_CLIENT_SECRET do ambiente
curl -X POST https://seu-backend.railway.app/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Resultado Esperado:**
Erro 500 ou resposta do iFood indicando credenciais inválidas.

---

## 📋 Checklist de Testes

### Configuração
- [ ] Variáveis de ambiente configuradas
- [ ] ENCRYPTION_KEY gerada (32 bytes base64)
- [ ] Credenciais iFood válidas (CLIENT_ID + SECRET)
- [ ] Conta existe na tabela `accounts`
- [ ] Tabela `ifood_store_auth` criada com constraints

### Fluxo Reviews
- [ ] Link: Solicitar userCode
- [ ] Link: Código salvo no banco com status pending
- [ ] Portal: Autorização realizada com sucesso
- [ ] Exchange: Tokens recebidos e criptografados
- [ ] Exchange: merchantId extraído e salvo
- [ ] Exchange: accounts.ifood_merchant_id atualizado
- [ ] Exchange: Status mudou para connected
- [ ] Status: Validação retorna connected
- [ ] Refresh: Token renovado com sucesso
- [ ] Refresh: Otimização (reutiliza token válido)

### Fluxo Financial
- [ ] Link: Solicitar userCode (scope financial)
- [ ] Exchange: Tokens salvos com scope financial
- [ ] Status: Validação funciona para financial
- [ ] Refresh: Renovação funciona para financial

### Cenários de Erro
- [ ] Token expirado detectado pelo status
- [ ] Refresh com token expirado
- [ ] Conta não encontrada
- [ ] Credenciais inválidas
- [ ] authorizationCode inválido
- [ ] Descriptografia falha (ENCRYPTION_KEY errada)

### Segurança
- [ ] Tokens armazenados criptografados (não plaintext)
- [ ] CORS configurado corretamente
- [ ] Service role key não exposta no frontend
- [ ] Logs não expõem tokens

---

## 🐛 Problemas Identificados e Soluções

### 1. ❌ Falta de Validação de Deployment

**Problema:** Não há arquivo de configuração Vercel/Railway para deployment.

**Solução:**
Criar `vercel.json` ou configurar rotas no Railway:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/ifood-auth/link",
      "dest": "/api/ifood-auth/link.ts"
    },
    {
      "src": "/api/ifood-auth/exchange",
      "dest": "/api/ifood-auth/exchange.ts"
    },
    {
      "src": "/api/ifood-auth/refresh",
      "dest": "/api/ifood-auth/refresh.ts"
    },
    {
      "src": "/api/ifood-auth/status",
      "dest": "/api/ifood-auth/status.ts"
    }
  ]
}
```

---

### 2. ⚠️ Tratamento de Erros Incompleto

**Problema:** Alguns erros não são logados adequadamente.

**Solução:**
Adicionar logging estruturado em todos os endpoints:

```typescript
console.error('[ifood-auth/link] Error:', {
  error: e.message,
  stack: e.stack,
  storeId,
  scope,
  timestamp: new Date().toISOString()
});
```

---

### 3. ⚠️ Falta de Rate Limiting

**Problema:** Endpoints podem ser abusados (especialmente /link).

**Solução:**
Implementar rate limiting por account_id:

```typescript
// Exemplo com upstash/ratelimit
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "10 m"), // 5 requests per 10 minutes
});

// No handler
const { success } = await ratelimit.limit(storeId);
if (!success) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

---

### 4. ✅ Extração de merchantId Robusta

**Status:** Implementado corretamente com 3 fallbacks:
1. Response direto da API
2. Chamada a `/merchants/me`
3. Decodificação do JWT

**Validação:** Testar todos os cenários para garantir que sempre extrai o merchantId.

---

### 5. ⚠️ Falta de Monitoramento

**Problema:** Não há métricas sobre sucesso/falha das autenticações.

**Solução:**
Adicionar tracking de eventos:

```typescript
// Exemplo com PostHog ou similar
analytics.track('ifood_auth_link_requested', {
  scope,
  accountId: storeId,
  success: true
});

analytics.track('ifood_auth_exchange_completed', {
  scope,
  accountId: resolvedAccountId,
  merchantId,
  success: true
});
```

---

### 6. ✅ Criptografia Implementada Corretamente

**Status:** AES-GCM com IV aleatório de 12 bytes.

**Validação:**
```bash
# Testar criptografia/descriptografia
node -e "
const crypto = require('crypto');
const key = crypto.randomBytes(32);
process.env.ENCRYPTION_KEY = key.toString('base64');
const { encryptToB64, decryptFromB64 } = require('./api/_shared/crypto.ts');
(async () => {
  const encrypted = await encryptToB64('test-token');
  console.log('Encrypted:', encrypted);
  const decrypted = await decryptFromB64(encrypted);
  console.log('Decrypted:', decrypted);
  console.log('Match:', decrypted === 'test-token');
})();
"
```

---

### 7. ⚠️ Documentação de API

**Problema:** Falta documentação OpenAPI/Swagger.

**Solução:**
Adicionar JSDoc e gerar Swagger:

```typescript
/**
 * @swagger
 * /api/ifood-auth/link:
 *   post:
 *     summary: Solicita código de vínculo OAuth
 *     tags: [iFood Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scope
 *               - storeId
 *             properties:
 *               scope:
 *                 type: string
 *                 enum: [reviews, financial]
 *               storeId:
 *                 type: string
 *                 format: uuid
 */
```

---

### 8. ✅ Unique Constraint Correto

**Status:** Constraint `(account_id, scope)` permite múltiplos escopos por conta.

**Validação:**
```sql
-- Deve permitir
INSERT INTO ifood_store_auth (account_id, scope, status) 
VALUES ('uuid-1', 'reviews', 'pending');

INSERT INTO ifood_store_auth (account_id, scope, status) 
VALUES ('uuid-1', 'financial', 'pending');

-- Deve falhar (duplicado)
INSERT INTO ifood_store_auth (account_id, scope, status) 
VALUES ('uuid-1', 'reviews', 'pending');
```

---

## 🚀 Próximos Passos

### Curto Prazo (Essencial)
1. **Criar arquivo de deployment** (vercel.json ou railway.toml)
2. **Configurar variáveis de ambiente** em produção
3. **Testar fluxo completo** em ambiente de staging
4. **Validar com merchant real** do iFood

### Médio Prazo (Recomendado)
1. Implementar rate limiting
2. Adicionar logging estruturado
3. Criar dashboard de monitoramento
4. Documentar API com Swagger

### Longo Prazo (Melhorias)
1. Implementar webhook para renovação automática
2. Adicionar suporte a múltiplos merchants por conta
3. Criar interface de administração
4. Implementar testes automatizados (Jest/Vitest)

---

## 📚 Referências

- [iFood - Autenticação](https://developer.ifood.com.br/pt-BR/docs/guides/authentication)
- [iFood - Fluxo Distribuído](https://developer.ifood.com.br/pt-BR/docs/guides/authentication/distributed)
- [iFood - Merchant Workflow](https://developer.ifood.com.br/pt-BR/docs/guides/merchant/workflow)
- [OAuth 2.0 RFC](https://oauth.net/2/)
- [AES-GCM Encryption](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

---

## 📞 Suporte

Para dúvidas sobre a implementação:
- Documentação iFood: https://developer.ifood.com.br/support
- Equipe Dex: suporte@usa-dex.com.br

---

**Última atualização:** 2025-01-03
**Versão:** 1.0.0
