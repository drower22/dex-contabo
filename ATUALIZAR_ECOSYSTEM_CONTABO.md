# 🚀 Atualizar Ecosystem no Contabo - Guia Específico

## 📋 Situação Atual

Você já tem um `ecosystem.config.js` no Contabo rodando apenas a API com `ts-node`.

---

## 🎯 Opção 1: Substituir Arquivo Completo (Mais Fácil)

### No seu PC:

```bash
# 1. Commitar código
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"
git add .
git commit -m "feat: add queue system for ifood sales sync"
git push origin main
```

### No Contabo (SSH):

```bash
# 2. Conectar
ssh root@seu-servidor-contabo

# 3. Ir para o diretório
cd /home/dex/dex-app

# 4. Puxar código
git pull origin main

# 5. Fazer backup do ecosystem atual
cp ecosystem.config.js ecosystem.config.js.OLD

# 6. Copiar o novo ecosystem
cp ecosystem.config.ATUALIZADO.js ecosystem.config.js

# 7. Instalar Redis
apt update
apt install redis-server -y
systemctl enable redis-server
systemctl start redis-server
redis-cli ping  # Deve retornar: PONG

# 8. Instalar dependências
npm install

# 9. Compilar TypeScript
npm run build

# 10. Criar diretório de logs (se não existir)
mkdir -p /root/.pm2/logs

# 11. Reiniciar PM2
pm2 stop all
pm2 delete all
pm2 start ecosystem.config.js
pm2 save

# 12. Verificar
pm2 status
```

---

## 🎯 Opção 2: Editar Manualmente (Mais Controle)

### No Contabo:

```bash
# 1. Fazer backup
cp ecosystem.config.js ecosystem.config.js.backup

# 2. Editar
nano ecosystem.config.js
```

### Adicione este bloco DEPOIS da vírgula do primeiro app:

```javascript
    // Worker de Sync de Vendas iFood (NOVO)
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/root/.pm2/logs/worker-error.log',
      out_file: '/root/.pm2/logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
```

### Como deve ficar:

```javascript
module.exports = {
  apps: [
    {
      name: 'dex-api',
      script: './node_modules/.bin/ts-node',
      args: 'api/server.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      error_file: '/root/.pm2/logs/dex-api-error.log',
      out_file: '/root/.pm2/logs/dex-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    },  // ← ATENÇÃO À VÍRGULA AQUI!
    
    // ADICIONAR AQUI ↓
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/root/.pm2/logs/worker-error.log',
      out_file: '/root/.pm2/logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
  ]
};
```

### Salvar e continuar:

```bash
# 3. Instalar Redis
apt install redis-server -y
systemctl enable redis-server
systemctl start redis-server

# 4. Instalar dependências e compilar
npm install
npm run build

# 5. Reiniciar PM2
pm2 reload ecosystem.config.js
pm2 save
```

---

## ✅ Verificar se Funcionou

```bash
pm2 status
```

Deve mostrar:

```
┌─────┬────────────────────────┬─────────┬─────────┬─────────┐
│ id  │ name                   │ status  │ restart │ uptime  │
├─────┼────────────────────────┼─────────┼─────────┼─────────┤
│ 0   │ dex-api                │ online  │ 0       │ 5m      │
│ 1   │ ifood-sales-worker     │ online  │ 0       │ 10s     │  ← NOVO!
└─────┴────────────────────────┴─────────┴─────────┴─────────┘
```

### Ver logs do worker:

```bash
pm2 logs ifood-sales-worker
```

Deve mostrar:

```
👷 Worker de sync de vendas iniciado
✅ Redis conectado
```

---

## 🧪 Testar o Sistema

```bash
curl -X POST https://api.usa-dex.com.br/api/ifood/sales/sync \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "seu-account-id",
    "merchantId": "seu-merchant-id", 
    "storeId": "seu-store-id",
    "periodStart": "2024-11-01",
    "periodEnd": "2024-11-18",
    "syncType": "backfill"
  }'
```

---

## 🐛 Se Algo Der Errado

### Restaurar backup:

```bash
cp ecosystem.config.js.backup ecosystem.config.js
pm2 reload ecosystem.config.js
```

### Ver erros:

```bash
pm2 logs ifood-sales-worker --err
```

### Verificar Redis:

```bash
redis-cli ping  # Deve retornar: PONG
systemctl status redis-server
```

---

## 📝 Checklist Final

- [ ] Redis instalado e rodando
- [ ] Dependências instaladas (`npm install`)
- [ ] Código compilado (`npm run build`)
- [ ] Ecosystem atualizado
- [ ] PM2 recarregado
- [ ] Worker aparece no `pm2 status`
- [ ] Logs do worker sem erros
- [ ] Redis conectado

---

## 🎉 Pronto!

Seu sistema de filas está rodando! 🚀

**Próximo passo:** Testar o endpoint de sync e ver os jobs sendo processados.
