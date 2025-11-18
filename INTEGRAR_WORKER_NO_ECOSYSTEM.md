# 🔧 Como Integrar o Worker ao Ecosystem Existente

## ⚠️ IMPORTANTE

**NÃO substitua o `ecosystem.config.js` existente no Contabo!**

Em vez disso, siga este guia para adicionar apenas o worker ao seu arquivo existente.

---

## 📋 Passo a Passo

### 1. Conectar no Contabo via SSH

```bash
ssh dex@seu-servidor-contabo
cd /home/dex/dex-app
```

### 2. Fazer backup do ecosystem atual

```bash
cp ecosystem.config.js ecosystem.config.js.backup
```

### 3. Editar o ecosystem.config.js

```bash
nano ecosystem.config.js
```

### 4. Adicionar configuração do worker

Encontre o array `apps: [` e adicione esta configuração **no final do array**, antes do `]`:

```javascript
    // Worker de Sync de Vendas iFood
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },
```

**⚠️ Atenção à vírgula!** Se já existir outro app antes, adicione uma vírgula após o `}` do app anterior.

### 5. Exemplo de como deve ficar

```javascript
module.exports = {
  apps: [
    // Seu app existente (exemplo)
    {
      name: 'dex-api',
      script: 'dist/api/server.js',
      // ... outras configurações
    },
    
    // ADICIONAR AQUI (note a vírgula acima)
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
```

### 6. Salvar e sair

- Pressione `Ctrl + X`
- Pressione `Y` para confirmar
- Pressione `Enter`

---

## 🚀 Reiniciar PM2

### Opção A: Reiniciar apenas o ecosystem (recomendado)

```bash
pm2 reload ecosystem.config.js
```

### Opção B: Reiniciar tudo do zero

```bash
pm2 stop all
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

---

## ✅ Verificar se funcionou

```bash
pm2 status
```

Você deve ver o novo worker na lista:

```
┌─────┬────────────────────────┬─────────┬─────────┬─────────┐
│ id  │ name                   │ status  │ restart │ uptime  │
├─────┼────────────────────────┼─────────┼─────────┼─────────┤
│ 0   │ dex-api                │ online  │ 0       │ 5m      │
│ 1   │ ifood-sales-worker     │ online  │ 0       │ 10s     │  ← NOVO!
└─────┴────────────────────────┴─────────┴─────────┴─────────┘
```

### Ver logs do worker

```bash
pm2 logs ifood-sales-worker
```

Você deve ver:

```
👷 Worker de sync de vendas iniciado
✅ Redis conectado
```

---

## 🐛 Se algo der errado

### Restaurar backup

```bash
cp ecosystem.config.js.backup ecosystem.config.js
pm2 reload ecosystem.config.js
```

### Ver erro específico

```bash
pm2 logs ifood-sales-worker --err
```

### Verificar sintaxe do JavaScript

```bash
node -c ecosystem.config.js
```

Se não retornar nada, está OK. Se retornar erro, há problema de sintaxe.

---

## 📝 Checklist Final

- [ ] Backup do ecosystem feito
- [ ] Worker adicionado ao ecosystem
- [ ] PM2 recarregado
- [ ] Worker aparece no `pm2 status`
- [ ] Logs do worker sem erros
- [ ] Redis conectado

---

## 🎉 Pronto!

Seu worker está integrado ao ecosystem existente sem conflitos! 🚀

**Próximo passo:** Testar o endpoint de sync
```bash
curl -X POST https://api.usa-dex.com.br/api/ifood/sales/sync \
  -H "Content-Type: application/json" \
  -d '{"accountId":"...","merchantId":"...","storeId":"...","periodStart":"2024-11-01","periodEnd":"2024-11-18","syncType":"backfill"}'
```
