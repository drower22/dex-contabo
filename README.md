# 🚀 Dex API - Autenticação iFood (Contabo)

Backend Node.js/TypeScript para autenticação distribuída do iFood, rodando no Contabo via PM2.

## 📋 Visão Geral

Esta API gerencia a autenticação OAuth 2.0 com o iFood usando o fluxo distribuído, permitindo que restaurantes vinculem suas contas para acesso a dados de reviews e financeiros.

### ✅ O Que Esta API Faz

- **Autenticação iFood**: Fluxo OAuth completo (link → exchange → refresh)
- **Gestão de Tokens**: Criptografia AES-GCM para armazenamento seguro
- **Proxies iFood**: Endpoints para merchant, reviews, settlements, etc
- **Cron Jobs**: Renovação automática de tokens expirando

### ❌ O Que NÃO Faz

- **Processamento de planilhas**: Está em `/backend-planilhas` (Python separado)
- **Deploy Vercel**: Removido, 100% Contabo agora

## 🏗️ Arquitetura

```
api/
├── _shared/                  # Código compartilhado
│   ├── config.ts            # Configurações centralizadas
│   ├── account-resolver.ts  # Resolução de IDs
│   ├── ifood-client.ts      # Cliente HTTP iFood
│   ├── enhanced-logger.ts   # Logs estruturados
│   ├── crypto.ts            # Criptografia AES-GCM
│   └── retry.ts             # Retry logic
│
├── ifood-auth/              # Autenticação OAuth
│   ├── link.ts              # POST - Gerar userCode
│   ├── exchange.ts          # POST - Trocar código por tokens
│   ├── refresh.ts           # POST - Renovar tokens
│   ├── status.ts            # GET - Validar status
│   └── health.ts            # GET - Health check
│
├── ifood/                   # Proxies para API iFood
│   ├── merchant.ts          # Dados do merchant
│   ├── reviews.ts           # Avaliações
│   ├── settlements.ts       # Repasses
│   └── reconciliation.ts    # Conciliação
│
├── cron/                    # Jobs agendados
│   ├── refresh-tokens.ts    # Renovar tokens expirando
│   └── health-check.ts      # Monitoramento
│
└── server.ts                # Servidor Express
```

## 🚀 Quick Start

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Variáveis de Ambiente

```bash
cp env.example .env
nano .env
```

**Variáveis obrigatórias**:
```env
# Supabase
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# iFood - Reviews
IFOOD_CLIENT_ID_REVIEWS=seu-client-id
IFOOD_CLIENT_SECRET_REVIEWS=seu-client-secret

# iFood - Financial
IFOOD_CLIENT_ID_FINANCIAL=seu-client-id
IFOOD_CLIENT_SECRET_FINANCIAL=seu-client-secret

# Criptografia (gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
ENCRYPTION_KEY=sua-chave-base64

# CORS
CORS_ORIGIN=https://seu-frontend.vercel.app
```

### 3. Validar Ambiente

```bash
chmod +x VALIDATE_ENV.sh
./VALIDATE_ENV.sh
```

### 4. Rodar Localmente

```bash
npm run dev
# Servidor rodando em http://localhost:3000
```

### 5. Testar

```bash
# Health check
curl http://localhost:3000/api/ifood-auth/health

# Solicitar userCode
curl -X POST http://localhost:3000/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"seu-account-id"}'
```

## 🔧 Deploy no Contabo

### Via GitHub Actions (Automático)

```bash
git add .
git commit -m "feat: atualização da API"
git push origin main
# Deploy automático via .github/workflows/deploy.yml
```

### Manual

```bash
ssh dex@seu-servidor
cd /home/dex/dex-app
git pull origin main
npm install
pm2 restart dex-api
```

## 📝 Scripts Disponíveis

```bash
npm run dev              # Rodar localmente
npm run start:prod       # Rodar em produção
npm run pm2:start        # Iniciar com PM2
npm run pm2:restart      # Reiniciar PM2
npm run pm2:logs         # Ver logs PM2
npm run pm2:status       # Status PM2
npm run validate         # Validar ambiente
npm test                 # Rodar testes
npm run type-check       # Verificar tipos TypeScript
```

## 🔐 Fluxo de Autenticação

### 1. Link (Gerar userCode)

```bash
POST /api/ifood-auth/link
{
  "scope": "reviews",
  "storeId": "uuid-da-conta"
}

# Resposta:
{
  "userCode": "ABC123",
  "verificationUrl": "https://portal.ifood.com.br/...",
  "authorizationCodeVerifier": "verifier_xyz...",
  "expiresIn": 600
}
```

### 2. Autorizar no Portal iFood

Usuário acessa `verificationUrl` e insere `userCode`.

### 3. Exchange (Trocar código por tokens)

```bash
POST /api/ifood-auth/exchange
{
  "scope": "reviews",
  "storeId": "uuid-da-conta",
  "authorizationCode": "codigo-do-portal",
  "authorizationCodeVerifier": "verifier_xyz..."
}

# Resposta:
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

### 4. Status (Validar autenticação)

```bash
GET /api/ifood-auth/status?accountId=uuid&scope=reviews

# Resposta:
{
  "status": "connected",
  "message": "Token validated successfully",
  "merchantId": "merchant-id"
}
```

### 5. Refresh (Renovar token)

```bash
POST /api/ifood-auth/refresh
{
  "scope": "reviews",
  "storeId": "uuid-ou-merchant-id"
}

# Resposta:
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600
}
```

## 🐛 Troubleshooting

### Erro: "Missing ENCRYPTION_KEY"

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Adicione o output ao .env
echo "ENCRYPTION_KEY=<output>" >> .env
```

### Erro: "Account not found"

Verifique se o `storeId` existe na tabela `accounts`:

```sql
SELECT id, ifood_merchant_id FROM accounts WHERE id = 'seu-uuid';
```

### Erro: "Failed to decrypt token"

ENCRYPTION_KEY mudou. Solução: Re-autenticar todas as contas.

```sql
DELETE FROM ifood_store_auth WHERE account_id = 'uuid';
```

### Ver Logs Detalhados

```bash
# No servidor
pm2 logs dex-api --lines 100

# Erros apenas
pm2 logs dex-api --err --lines 50
```

## 📚 Documentação Adicional

- **[REFACTORING_GUIDE.md](./REFACTORING_GUIDE.md)** - Guia de refatoração
- **[ACOES_IMEDIATAS.md](./ACOES_IMEDIATAS.md)** - Resolver problemas de vínculo
- **[api/ifood-auth/README.md](./api/ifood-auth/README.md)** - Documentação detalhada da autenticação
- **[VALIDATE_ENV.sh](./VALIDATE_ENV.sh)** - Script de validação

## 🔄 Estrutura de Dados (Supabase)

### Tabela: `ifood_store_auth`

```sql
CREATE TABLE ifood_store_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  ifood_merchant_id TEXT,
  link_code TEXT,
  verifier TEXT,
  access_token TEXT,  -- Criptografado
  refresh_token TEXT, -- Criptografado
  expires_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('pending', 'connected', 'error')),
  scope TEXT CHECK (scope IN ('reviews', 'financial')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, scope)
);
```

## 🎯 Roadmap

- [x] Autenticação OAuth distribuída
- [x] Criptografia de tokens
- [x] Renovação automática de tokens
- [x] Logs estruturados
- [x] Validação de ambiente
- [ ] Rate limiting
- [ ] Circuit breaker
- [ ] Métricas e monitoramento
- [ ] Testes E2E

## 📞 Suporte

- **Issues**: GitHub Issues
- **Email**: suporte@usa-dex.com.br
- **Documentação iFood**: https://developer.ifood.com.br

---

**Versão**: 2.0.0  
**Última atualização**: 2025-01-08  
**Deploy**: Contabo (PM2)
