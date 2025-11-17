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

## 📁 Estrutura

```
api/
├── _shared/          # Utilitários compartilhados (crypto, logger, ifood-client)
├── ifood/            # Endpoints de dados iFood (reconciliation, settlements, reviews)
├── ifood-financial/  # Endpoints financeiros (payouts-unified)
├── ingest/           # Ingestão de dados (reconciliation)
├── cron/             # Jobs agendados (health-check)
├── ai/               # Endpoints de AI
└── server.ts         # Servidor Express
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
