# 🚀 API Node.js - DEX Parceiros iFood

API backend para integração com iFood e gerenciamento de dados.

## 📋 Estrutura

```
api/
├── ifood/                    # Endpoints iFood
│   ├── merchant.ts          # Proxy merchant
│   ├── reviews.ts           # Proxy reviews
│   ├── settlements.ts       # Proxy settlements
│   └── reconciliation.ts    # Proxy reconciliation
├── ifood-auth/              # Autenticação iFood
│   ├── refresh.ts           # Refresh token
│   └── callback.ts          # OAuth callback
├── ingest/                  # Ingestão de dados
└── _shared/                 # Utilitários compartilhados
```

## 🔧 Configuração

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
