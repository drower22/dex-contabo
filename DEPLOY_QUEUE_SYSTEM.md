# 🚀 Deploy do Sistema de Filas - Guia Rápido

## 📋 Checklist Pré-Deploy

- [ ] Código commitado no GitHub
- [ ] Acesso SSH ao Contabo
- [ ] Variáveis de ambiente configuradas

---

## 🎯 Opção 1: Instalação Automática (Recomendado)

### No seu computador local:

```bash
# 1. Commitar e enviar código
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"
git add .
git commit -m "feat: add queue system for ifood sales sync"
git push origin main
```

### No servidor Contabo (via SSH):

```bash
# 2. Conectar no Contabo
ssh dex@seu-servidor-contabo

# 3. Ir para o diretório do projeto
cd /home/dex/dex-app

# 4. Puxar código do GitHub
git pull origin main

# 5. Dar permissão de execução ao script
chmod +x INSTALL_QUEUE_SYSTEM.sh

# 6. Executar instalação automática
./INSTALL_QUEUE_SYSTEM.sh
```

**Pronto! O sistema está instalado e rodando.** ✅

---

## 🎯 Opção 2: Instalação Manual

### 1. Instalar Redis

```bash
sudo apt update
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping  # Deve retornar: PONG
```

### 2. Configurar variáveis de ambiente

Editar `/home/dex/dex-app/.env`:

```bash
nano /home/dex/dex-app/.env
```

Adicionar/verificar:

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key

# iFood Proxy
IFOOD_PROXY_BASE=https://proxy.usa-dex.com.br/api/ifood-proxy
SHARED_PROXY_KEY=sua-shared-key
```

### 3. Instalar dependências e compilar

```bash
cd /home/dex/dex-app
npm install
npm run build
```

### 4. Criar diretório de logs

```bash
mkdir -p /home/dex/dex-app/logs
```

### 5. Parar PM2 antigo

```bash
pm2 stop all
pm2 delete all
```

### 6. Iniciar com novo ecosystem

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Configurar para iniciar no boot
```

---

## 🔍 Verificação

### Verificar se está rodando

```bash
pm2 status
```

Você deve ver:

```
┌─────┬────────────────────────┬─────────┬─────────┬─────────┐
│ id  │ name                   │ status  │ restart │ uptime  │
├─────┼────────────────────────┼─────────┼─────────┼─────────┤
│ 0   │ dex-api                │ online  │ 0       │ 10s     │
│ 1   │ ifood-sales-worker     │ online  │ 0       │ 10s     │
└─────┴────────────────────────┴─────────┴─────────┴─────────┘
```

### Ver logs

```bash
# Logs da API
pm2 logs dex-api

# Logs do worker
pm2 logs ifood-sales-worker

# Todos os logs
pm2 logs
```

### Testar Redis

```bash
redis-cli ping  # Deve retornar: PONG
redis-cli info  # Ver informações do Redis
```

---

## 🧪 Testar o Sistema

### 1. Testar endpoint de sync

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

Resposta esperada:

```json
{
  "success": true,
  "message": "Sync iniciado",
  "jobId": "seu-account-id-seu-merchant-id-2024-11-01-2024-11-18"
}
```

### 2. Consultar status do job

```bash
curl https://api.usa-dex.com.br/api/ifood/sales/sync/JOB_ID
```

### 3. Monitorar fila no Redis

```bash
redis-cli

# Ver jobs aguardando
LLEN bull:ifood-sales-sync:wait

# Ver jobs em processamento
LLEN bull:ifood-sales-sync:active

# Ver jobs completados
LLEN bull:ifood-sales-sync:completed
```

---

## 📊 Monitoramento

### Ver status em tempo real

```bash
pm2 monit
```

### Ver logs em tempo real

```bash
pm2 logs --lines 100
```

### Reiniciar worker

```bash
pm2 restart ifood-sales-worker
```

### Reiniciar tudo

```bash
pm2 restart all
```

---

## 🐛 Troubleshooting

### Worker não inicia

```bash
# Ver erro específico
pm2 logs ifood-sales-worker --err

# Verificar se Redis está rodando
sudo systemctl status redis-server

# Reiniciar Redis
sudo systemctl restart redis-server
```

### Jobs não processam

```bash
# Ver logs do worker
pm2 logs ifood-sales-worker

# Verificar conexão Redis
redis-cli ping

# Limpar fila (CUIDADO!)
redis-cli FLUSHDB
```

### Porta 3000 em uso

```bash
# Ver processo usando a porta
sudo lsof -i :3000

# Matar processo
sudo kill -9 PID

# Ou usar o script
bash KILL_ZOMBIE_PROCESSES.md
```

---

## 📚 Documentação Adicional

- **Setup completo**: `IFOOD_SALES_SYNC_SETUP.md`
- **Matar processos**: `KILL_ZOMBIE_PROCESSES.md`
- **Logs do Supabase**: Consultar tabela `logs`
- **Status dos syncs**: Consultar tabela `ifood_sales_sync_status`

---

## ✅ Checklist Pós-Deploy

- [ ] PM2 rodando com 2 processos (api + worker)
- [ ] Redis respondendo ao ping
- [ ] Logs sem erros
- [ ] Teste de sync funcionando
- [ ] Jobs sendo processados
- [ ] Dados salvos no Supabase

---

## 🎉 Pronto!

Seu sistema de filas está rodando! 🚀

**Próximos passos:**
1. Integrar com o frontend
2. Criar dashboard de monitoramento
3. Configurar sync diário automático
4. Adicionar alertas de erro
