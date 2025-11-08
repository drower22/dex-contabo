# 🏗️ Arquitetura - Dex API (Pós-Limpeza)

## 📊 Visão Geral

Arquitetura simplificada focada em **autenticação iFood** rodando no **Contabo**.

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vercel)                        │
│              https://dex-parceiros.vercel.app               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  API Node.js (Contabo)                      │
│                  Express + TypeScript                        │
│                  PM2 + Nginx                                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/ifood-auth/*  (Autenticação OAuth)            │  │
│  │  - link.ts     → Gerar userCode                      │  │
│  │  - exchange.ts → Trocar código por tokens            │  │
│  │  - refresh.ts  → Renovar tokens                      │  │
│  │  - status.ts   → Validar status                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/ifood/*  (Proxies para API iFood)             │  │
│  │  - merchant.ts     → Dados do merchant               │  │
│  │  - reviews.ts      → Avaliações                      │  │
│  │  - settlements.ts  → Repasses                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/_shared/*  (Código Compartilhado)             │  │
│  │  - config.ts          → Configurações                │  │
│  │  - ifood-client.ts    → Cliente HTTP                 │  │
│  │  - account-resolver.ts → Resolução de IDs            │  │
│  │  - enhanced-logger.ts  → Logs                        │  │
│  │  - crypto.ts          → Criptografia                 │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   iFood Merchant API                        │
│           https://merchant-api.ifood.com.br                 │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ OAuth 2.0
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Portal Parceiro iFood                    │
│              (Usuário autoriza com userCode)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Supabase (Dados)                         │
│  - accounts                                                 │
│  - ifood_store_auth (tokens criptografados)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│          Backend Python (SEPARADO - Planilhas)              │
│                  /backend-planilhas/                        │
│  - Processamento de planilhas pesadas                      │
│  - Não faz parte da autenticação iFood                     │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Separação de Responsabilidades

### API Node.js (Contabo) - `/api`

**Responsabilidade**: Autenticação iFood e proxies

**Tecnologias**:
- Node.js 18+
- TypeScript
- Express
- PM2
- Nginx (reverse proxy)

**Endpoints**:
- `/api/ifood-auth/*` - OAuth iFood
- `/api/ifood/*` - Proxies para API iFood
- `/api/cron/*` - Jobs agendados

### Backend Python - `/backend-planilhas`

**Responsabilidade**: Processamento de planilhas

**Tecnologias**:
- Python 3.10+
- FastAPI
- Pandas

**Uso**: Apenas para análise de dados pesados, **não autenticação**

## 🔄 Fluxo de Dados

### 1. Autenticação (OAuth Distribuído)

```
Frontend → POST /api/ifood-auth/link
         ← {userCode, verificationUrl}

Usuário → Portal iFood (autoriza com userCode)
        ← authorizationCode

Frontend → POST /api/ifood-auth/exchange {authCode}
         ← {access_token, refresh_token}

API → Supabase (salva tokens criptografados)
```

### 2. Uso de Tokens

```
Frontend → POST /api/ifood-auth/refresh
         ← {access_token, refresh_token}

Frontend → GET /api/ifood/reviews (com token)
API → iFood API (proxy com token)
    ← dados
Frontend ← dados
```

### 3. Renovação Automática (Cron)

```
Cron (a cada 6h) → GET ifood_store_auth (tokens expirando)
                 → POST /api/ifood-auth/refresh (para cada)
                 → Atualiza tokens no Supabase
```

## 🔐 Segurança

### Criptografia de Tokens

```typescript
// Tokens NUNCA são salvos em plaintext
const encryptedToken = await encryptToB64(accessToken);
await supabase.from('ifood_store_auth').insert({
  access_token: encryptedToken,  // AES-GCM
  refresh_token: encryptedRefresh // AES-GCM
});
```

### Variáveis Sensíveis

```env
# Nunca commitadas no Git
ENCRYPTION_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
IFOOD_CLIENT_SECRET_REVIEWS=...
IFOOD_CLIENT_SECRET_FINANCIAL=...
```

### CORS

```typescript
// Apenas frontend autorizado
CORS_ORIGIN=https://dex-parceiros.vercel.app
```

## 📦 Módulos Principais

### 1. `_shared/config.ts`

**Responsabilidade**: Configurações centralizadas

```typescript
export function getIFoodCredentials(scope: 'reviews' | 'financial'): {
  clientId: string;
  clientSecret: string;
}
```

**Benefícios**:
- ✅ Lógica de credenciais em um único lugar
- ✅ Validação de ambiente
- ✅ Fallbacks configuráveis

### 2. `_shared/ifood-client.ts`

**Responsabilidade**: Cliente HTTP para iFood

```typescript
class IFoodClient {
  async requestUserCode(scope): Promise<UserCodeResponse>
  async exchangeAuthorizationCode(scope, code, verifier): Promise<TokenResponse>
  async refreshAccessToken(scope, refreshToken): Promise<TokenResponse>
  async getMerchantInfo(accessToken): Promise<MerchantInfo>
}
```

**Benefícios**:
- ✅ Todas as chamadas à API iFood centralizadas
- ✅ Retry logic (futuro)
- ✅ Circuit breaker (futuro)

### 3. `_shared/account-resolver.ts`

**Responsabilidade**: Resolução de identificadores

```typescript
async function resolveAccountId(identifier: string): Promise<{
  id: string;
  ifood_merchant_id: string | null;
}>
```

**Benefícios**:
- ✅ Aceita UUID ou merchantId
- ✅ Lógica de lookup unificada
- ✅ Erros claros

### 4. `_shared/enhanced-logger.ts`

**Responsabilidade**: Logging estruturado

```typescript
logger.info('Token renovado', {
  traceId: 'abc123',
  accountId: 'uuid',
  scope: 'reviews'
});
```

**Benefícios**:
- ✅ Trace IDs para rastreamento
- ✅ Sanitização de dados sensíveis
- ✅ Contexto reutilizável

## 🚀 Deploy

### Ambiente: Contabo VPS

**Servidor**: Ubuntu 22.04  
**Process Manager**: PM2  
**Reverse Proxy**: Nginx  
**Deploy**: GitHub Actions

### Fluxo de Deploy

```
1. git push origin main
2. GitHub Actions triggered
3. SSH para Contabo
4. git pull
5. npm install
6. pm2 restart dex-api
7. nginx reload
```

### Configuração PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'dex-api',
    script: 'api/server.ts',
    interpreter: 'ts-node',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

### Configuração Nginx

```nginx
location /api/ {
  proxy_pass http://localhost:3000/api/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

## 📊 Monitoramento

### Health Checks

```bash
# API
GET /api/ifood-auth/health

# PM2
pm2 status dex-api
pm2 logs dex-api
```

### Métricas (Futuro)

- Taxa de sucesso de autenticação
- Tempo de resposta médio
- Tokens expirando
- Erros por endpoint

## 🔄 Evolução da Arquitetura

### Antes (Confuso)

```
❌ Backend Python + Node.js misturados
❌ Vercel + Contabo + Local
❌ Código duplicado em 4 arquivos
❌ Lógica de credenciais repetida
❌ Logs sem estrutura
```

### Depois (Limpo)

```
✅ Node.js para auth, Python isolado para planilhas
✅ 100% Contabo
✅ Código centralizado em _shared/
✅ Credenciais em config.ts
✅ Logs estruturados com trace IDs
```

## 📝 Decisões Arquiteturais

### Por que Node.js para Auth?

- ✅ Melhor suporte a TypeScript
- ✅ Ecossistema rico (Express, PM2)
- ✅ Fácil integração com Supabase
- ✅ Async/await nativo

### Por que Manter Python Separado?

- ✅ Pandas é superior para análise de dados
- ✅ Não misturar responsabilidades
- ✅ Pode escalar independentemente

### Por que Contabo em vez de Vercel?

- ✅ Sem limite de 12 funções serverless
- ✅ Controle total do ambiente
- ✅ Melhor para long-running processes
- ✅ Custo mais previsível

## 🎯 Próximos Passos

1. **Rate Limiting**: Proteger contra abuse
2. **Circuit Breaker**: Falhas graceful com iFood API
3. **Métricas**: Prometheus + Grafana
4. **Testes E2E**: Cypress ou Playwright
5. **Cache**: Redis para tokens válidos

---

**Última atualização**: 2025-01-08  
**Versão**: 2.0.0 (Pós-limpeza)
