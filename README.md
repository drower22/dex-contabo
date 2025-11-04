# 🚀 Dex Contabo - Backend Centralizado

Backend completo em **TypeScript** para APIs do iFood + **Python** apenas para processamento pesado de planilhas.

## 📋 Arquitetura

```
dex-contabo/
├── api/                          # 🟦 TypeScript - Todas as APIs
│   ├── _shared/                  # Utilitários compartilhados
│   │   ├── crypto.ts            # Criptografia AES-GCM
│   │   ├── discord.ts           # Notificações Discord
│   │   ├── logger.ts            # Logging estruturado
│   │   └── retry.ts             # Retry com backoff
│   ├── ifood-auth/              # Autenticação iFood
│   │   ├── link.ts              # Solicitar código
│   │   ├── exchange.ts          # Trocar por tokens
│   │   ├── refresh.ts           # Renovar tokens
│   │   ├── status.ts            # Validar status
│   │   └── health.ts            # Health check
│   ├── ifood/                   # Proxies iFood
│   │   ├── merchant.ts
│   │   ├── reviews.ts
│   │   ├── settlements.ts
│   │   └── financial/
│   └── cron/                    # Jobs automáticos
│       ├── refresh-tokens.ts    # Renova tokens (6h)
│       └── health-check.ts      # Monitor (15min)
│
├── backend/                      # 🐍 Python - Processamento pesado
│   ├── scripts/
│   │   ├── process_report.py   # Processa planilhas financeiras
│   │   └── process_conciliation.py
│   └── main.py                  # FastAPI (opcional)
│
├── tests/                        # 🧪 Testes automatizados
│   ├── crypto.test.ts
│   ├── health.test.ts
│   └── setup.ts
│
└── vercel.json                   # Configuração de deploy
```

## ⚡ Quick Start

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Variáveis de Ambiente

```bash
# Copie o template
cp env.template .env

# Edite e preencha os valores
nano .env
```

**Variáveis obrigatórias:**
```env
# Supabase
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# iFood
IFOOD_CLIENT_ID_REVIEWS=...
IFOOD_CLIENT_SECRET_REVIEWS=...
IFOOD_CLIENT_ID_FINANCIAL=...
IFOOD_CLIENT_SECRET_FINANCIAL=...

# Criptografia (gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
ENCRYPTION_KEY=...

# Discord (para alertas)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Cron (gere um secret aleatório)
CRON_SECRET=...
```

### 3. Rodar Localmente

```bash
# Desenvolvimento
npm run dev

# Testes
npm test

# Testes com watch
npm run test:watch

# Coverage
npm run test:coverage
```

### 4. Deploy no Vercel

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy
vercel

# Deploy para produção
vercel --prod
```

## 🔐 Autenticação iFood

### Fluxo Completo

```typescript
// 1. Solicitar código de vínculo
POST /api/ifood-auth/link
{
  "scope": "reviews",
  "storeId": "uuid-da-conta"
}

// 2. Usuário autoriza no Portal do Parceiro

// 3. Trocar código por tokens
POST /api/ifood-auth/exchange
{
  "scope": "reviews",
  "storeId": "uuid-da-conta",
  "authorizationCode": "ABC123",
  "authorizationCodeVerifier": "verifier..."
}

// 4. Validar status
GET /api/ifood-auth/status?accountId=uuid&scope=reviews

// 5. Renovar token
POST /api/ifood-auth/refresh
{
  "scope": "reviews",
  "storeId": "merchant-id"
}
```

## 🧪 Testes Automatizados

### Rodar Testes

```bash
# Todos os testes
npm test

# Com notificações no Discord
DISCORD_WEBHOOK_URL=https://... npm test

# Apenas crypto
npm test crypto

# Apenas health
npm test health

# UI interativa
npm run test:ui
```

### Testes Incluídos

- ✅ **Crypto**: Criptografia/descriptografia
- ✅ **Health**: Validação de dependências
- ✅ **Auth Flow**: Fluxo completo de autenticação (manual)

### Notificações no Discord

Todos os testes enviam resultados para o Discord automaticamente:

```
✅ Teste: Crypto: Encrypt/Decrypt - PASSOU (0.15s)
❌ Teste: Health Check - FALHOU (2.34s)
   Detalhes: Supabase connection failed
```

## 🤖 Automação

### Cron Jobs (Vercel)

#### 1. Renovação de Tokens (a cada 6 horas)
```
POST /api/cron/refresh-tokens
Authorization: Bearer {CRON_SECRET}
```

Renova automaticamente tokens que expiram em < 1 hora.

#### 2. Health Check (a cada 15 minutos)
```
POST /api/cron/health-check
Authorization: Bearer {CRON_SECRET}
```

Monitora saúde do sistema e notifica no Discord se houver problemas.

### Configuração no vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-tokens",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/cron/health-check",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

## 📊 Monitoramento

### Health Check

```bash
curl https://seu-app.vercel.app/api/ifood-auth/health
```

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "supabase": true,
    "encryption": true,
    "ifood_reviews": true,
    "ifood_financial": true
  },
  "timestamp": "2025-01-03T20:00:00.000Z"
}
```

### Alertas no Discord

O sistema envia notificações automáticas para:

- 🚨 **Erros**: Falhas em endpoints
- ⚠️ **Avisos**: Health check falhou, tokens não renovados
- ✅ **Sucesso**: Deploy, testes passaram
- 🧪 **Testes**: Resultados de testes automatizados

### Configurar Webhook do Discord

1. No Discord, vá em **Configurações do Servidor** → **Integrações** → **Webhooks**
2. Clique em **Novo Webhook**
3. Copie a URL do webhook
4. Configure no Vercel:

```bash
vercel env add DISCORD_WEBHOOK_URL
```

## 🔒 Segurança

### Criptografia

- **Algoritmo**: AES-GCM (256 bits)
- **IV**: 12 bytes aleatórios por token
- **Formato**: Base64(IV + ciphertext)

### Boas Práticas

- ✅ Tokens nunca em plaintext
- ✅ Service role key protegida
- ✅ CORS configurado
- ✅ Rate limiting (retry com backoff)
- ✅ Logs estruturados (JSON)
- ✅ Validação de entrada

## 🐛 Troubleshooting

### Erro: "Missing ENCRYPTION_KEY"

```bash
# Gerar chave
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Configurar no Vercel
vercel env add ENCRYPTION_KEY
```

### Erro: "Decryption failed"

ENCRYPTION_KEY mudou. Re-autentique todas as contas.

### Testes falhando localmente

```bash
# Instalar dependências
npm install

# Verificar .env
cat .env

# Rodar com logs
DEBUG=* npm test
```

### Discord não recebe notificações

```bash
# Testar webhook
curl -X POST https://discord.com/api/webhooks/... \
  -H "Content-Type: application/json" \
  -d '{"content":"Teste"}'

# Verificar variável
vercel env ls
```

## 📚 Documentação Completa

- [Validação do Fluxo iFood](./IFOOD_AUTH_VALIDATION.md)
- [Script de Teste Bash](./test-ifood-auth.sh)
- [Queries SQL](./test-ifood-auth.sql)
- [Docs da API](./api/ifood-auth/README.md)

## 🚀 Deploy

### Vercel (Recomendado)

1. **Conectar repositório**
   ```bash
   vercel link
   ```

2. **Configurar variáveis**
   ```bash
   vercel env add SUPABASE_URL
   vercel env add SUPABASE_SERVICE_ROLE_KEY
   vercel env add ENCRYPTION_KEY
   vercel env add DISCORD_WEBHOOK_URL
   # ... todas as outras
   ```

3. **Deploy**
   ```bash
   vercel --prod
   ```

### Railway (Alternativa)

1. **Criar novo projeto**
2. **Conectar repositório GitHub**
3. **Adicionar variáveis de ambiente**
4. **Deploy automático**

## 🔄 CI/CD

### GitHub Actions (Exemplo)

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
        env:
          ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

## 📞 Suporte

- **Documentação iFood**: https://developer.ifood.com.br/support
- **Equipe Dex**: suporte@usa-dex.com.br

---

**Versão**: 1.0.0  
**Última atualização**: 2025-01-03
