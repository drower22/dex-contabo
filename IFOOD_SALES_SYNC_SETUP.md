# 🚀 Setup do Sistema de Sync de Vendas iFood

## 📋 Pré-requisitos

### 1. Instalar Redis no Contabo

```bash
# Atualizar sistema
sudo apt update

# Instalar Redis
sudo apt install redis-server -y

# Configurar Redis para iniciar automaticamente
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verificar se está rodando
redis-cli ping
# Deve retornar: PONG
```

### 2. Instalar dependências do Node.js

```bash
cd /home/dex/dex-app
npm install
```

## ⚙️ Configuração

### 1. Adicionar variáveis de ambiente

Editar `/home/dex/dex-app/.env`:

```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Deixar vazio se não tiver senha

# Supabase (já deve ter)
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-key

# iFood Proxy (já deve ter)
IFOOD_PROXY_BASE=https://proxy.usa-dex.com.br/api/ifood-proxy
SHARED_PROXY_KEY=sua-shared-key
```

### 2. Compilar TypeScript

```bash
cd /home/dex/dex-app
npm run build
```

## 🚀 Iniciar Workers

### Opção A: PM2 (Recomendado)

Editar `ecosystem.config.js` e adicionar o worker:

```javascript
module.exports = {
  apps: [
    {
      name: 'dex-api',
      script: 'dist/api/server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

Iniciar:

```bash
pm2 start ecosystem.config.js
pm2 save
```

### Opção B: Manual (para testes)

```bash
cd /home/dex/dex-app
node dist/workers/ifood-sales-sync.worker.js
```

## 📡 Endpoints da API

### 1. Disparar Sync (Backfill)

```bash
POST https://api.usa-dex.com.br/api/ifood/sales/sync

Body:
{
  "accountId": "uuid-da-conta",
  "merchantId": "merchant-id-ifood",
  "storeId": "uuid-da-loja",
  "periodStart": "2024-01-01",
  "periodEnd": "2024-11-18",
  "syncType": "backfill"
}

Response:
{
  "success": true,
  "message": "Sync iniciado",
  "jobId": "uuid-da-conta-merchant-id-2024-01-01-2024-11-18"
}
```

### 2. Consultar Status do Sync

```bash
GET https://api.usa-dex.com.br/api/ifood/sales/sync/:jobId

Response:
{
  "success": true,
  "job": {
    "id": "...",
    "state": "completed",
    "progress": {
      "currentPage": 100,
      "totalPages": 100,
      "totalSales": 300,
      "processedSales": 300,
      "status": "completed"
    }
  }
}
```

## 🔍 Monitoramento

### Ver logs do worker

```bash
pm2 logs ifood-sales-worker
```

### Ver status das filas

```bash
# Conectar no Redis
redis-cli

# Ver jobs na fila
LLEN bull:ifood-sales-sync:wait

# Ver jobs em processamento
LLEN bull:ifood-sales-sync:active

# Ver jobs completados
LLEN bull:ifood-sales-sync:completed

# Ver jobs com falha
LLEN bull:ifood-sales-sync:failed
```

### Consultar logs no Supabase

```sql
SELECT * FROM logs 
WHERE level = 'error' 
AND message LIKE '%sync%'
ORDER BY created_at DESC 
LIMIT 100;
```

### Consultar status dos syncs

```sql
SELECT * FROM ifood_sales_sync_status 
ORDER BY started_at DESC 
LIMIT 50;
```

## 🔄 Sync Diário Automático

### Criar cron job

```bash
# Editar crontab
crontab -e

# Adicionar linha (roda todo dia às 6h)
0 6 * * * curl -X POST https://api.usa-dex.com.br/api/ifood/sales/sync-daily
```

## 🐛 Troubleshooting

### Redis não conecta

```bash
# Verificar se Redis está rodando
sudo systemctl status redis-server

# Reiniciar Redis
sudo systemctl restart redis-server

# Ver logs do Redis
sudo journalctl -u redis-server -f
```

### Worker não processa jobs

```bash
# Verificar logs
pm2 logs ifood-sales-worker

# Reiniciar worker
pm2 restart ifood-sales-worker

# Ver status
pm2 status
```

### Jobs ficam travados

```bash
# Limpar fila (CUIDADO!)
redis-cli FLUSHDB

# Ou limpar apenas a fila específica
redis-cli DEL bull:ifood-sales-sync:wait
redis-cli DEL bull:ifood-sales-sync:active
```

## 📊 Performance

- **Concorrência**: 10 workers simultâneos
- **Rate Limit**: 100 requisições/minuto
- **Retry**: 3 tentativas com backoff exponencial
- **Batch Size**: Salva todas as vendas de uma página de uma vez

## 🎯 Próximos Passos

1. ✅ Testar sync manual via API
2. ✅ Verificar logs no Supabase
3. ✅ Configurar sync diário automático
4. ✅ Criar dashboard de monitoramento no frontend
5. ✅ Adicionar alertas de erro
