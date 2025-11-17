# 🚀 Dex Contabo API

API backend para o projeto Dex, rodando no Contabo.

## ⚠️ IMPORTANTE: Arquitetura Atualizada (Nov 2025)

### **Auth agora é 100% Supabase Edge Functions**

- ✅ **Autenticação iFood** → Supabase Edge Functions
  - `ifood-auth-link`
  - `ifood-auth-exchange`
  - `ifood-auth-refresh`
  - `ifood-auth-refresh-all` (batch)
  
- ✅ **Refresh automático** → GitHub Actions (a cada hora)

- ✅ **Contabo** → Apenas endpoints de **dados** do iFood:
  - `/api/ifood/reconciliation`
  - `/api/ifood/financial/payouts-unified`
  - `/api/ingest/ifood-reconciliation`
  - `/api/ifood-proxy`

---

## 📁 Estrutura (Reorganizada Nov 2025)

```
api/
├── _shared/                    # Utilitários compartilhados
│   ├── config.ts              # Configurações
│   ├── crypto.ts              # Criptografia AES-GCM
│   ├── logger.ts              # Logger básico
│   ├── enhanced-logger.ts     # Logger avançado
│   ├── ifood-client.ts        # Cliente HTTP iFood
│   ├── cors.ts                # CORS helpers
│   ├── discord.ts             # Notificações Discord
│   ├── retry.ts               # Retry logic
│   ├── proxy.ts               # Proxy helpers
│   └── account-resolver.ts    # Resolver de contas
│
├── ifood/                      # Endpoints de dados iFood
│   ├── financial/             # Financeiro
│   │   ├── payouts.ts
│   │   ├── payouts-unified.ts
│   │   ├── settlements.ts
│   │   └── anticipations.ts
│   │
│   ├── reviews/               # Avaliações
│   │   ├── index.ts
│   │   ├── summary.ts
│   │   ├── settings.ts
│   │   ├── [reviewId].ts
│   │   └── [reviewId]/answers.ts
│   │
│   ├── reconciliation/        # Conciliação
│   │   ├── index.ts          # Download de relatórios
│   │   ├── ingest.ts         # Ingestão completa
│   │   └── debug.ts          # Debug de ingestão
│   │
│   └── merchant.ts            # Info do merchant
│
├── ai/                         # Endpoints de AI
│   ├── ai.handlers.ts
│   └── reviews.ts
│
└── server.ts                   # Servidor Express
```

## 🛠️ Desenvolvimento

### Variáveis de Ambiente

```env
# iFood API
IFOOD_BASE_URL=https://merchant-api.ifood.com.br
IFOOD_CLIENT_ID=seu-client-id
IFOOD_CLIENT_SECRET=seu-client-secret

# Supabase
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key

# CORS
CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app
```

## 🚀 Deploy

O deploy é automático via GitHub Actions quando há push para a branch `main`.

## 📝 Endpoints

### Merchant
- `GET /api/ifood-merchant?merchantId=xxx` - Detalhes da loja
- `GET /api/ifood-merchant?merchantId=xxx&endpoint=status` - Status
- `GET /api/ifood-merchant?merchantId=xxx&endpoint=opening-hours` - Horários

### Auth
- `GET /api/ifood-auth/refresh?scope=reviews&storeId=xxx` - Refresh token

### Reviews
- `GET /api/ifood/reviews?merchantId=xxx` - Listar reviews

### Settlements
- `GET /api/ifood/settlements?merchantId=xxx` - Listar repasses

### Reconciliation
- `GET /api/ifood/reconciliation?merchantId=xxx` - Conciliação
