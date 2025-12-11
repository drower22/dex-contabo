# 🚀 DEPLOY DE WORKERS NO CONTABO

## 📋 RESUMO DAS MUDANÇAS

### ✅ Workers Ativos (Após Deploy)
1. **`dex-api`** - API principal (porta 3000)
2. **`ifood-scheduler_worker`** - Cria jobs automáticos (settlements + anticipations)
3. **`ifood-sales_worker`** - Processa sync de vendas
4. **`ifood-settlements_worker`** - Processa repasses semanais
5. **`ifood-anticipations_worker`** - Processa antecipações diárias

### 🔴 Workers Removidos
- ❌ `ifood-conciliation_worker` (será implementado depois)
- ❌ `ifood-reconciliation-status_worker` (obsoleto)

---

## 🎯 PASSO A PASSO NO CONTABO

### **1. Parar e Remover Workers Obsoletos**

```bash
# Parar workers obsoletos
pm2 stop ifood-conciliation_worker
pm2 stop ifood-reconciliation-status_worker

# Deletar workers obsoletos
pm2 delete ifood-conciliation_worker
pm2 delete ifood-reconciliation-status_worker

# Verificar status
pm2 list
```

---

### **2. Fazer Pull do Código Atualizado**

```bash
cd /home/dex/dex-app

# Fazer backup do ecosystem.config.js atual (se necessário)
cp ecosystem.config.js ecosystem.config.js.backup

# Pull do repositório
git pull origin main

# Verificar se os novos arquivos foram baixados
ls -la dex-contabo/workers/ifood-anticipations.worker.ts
ls -la dex-contabo/workers/ifood-scheduler.worker.ts
```

---

### **3. Compilar TypeScript (se necessário)**

```bash
# Se você compila antes de rodar
npm run build

# Verificar se os arquivos foram compilados
ls -la dist/workers/
```

**NOTA:** Os workers estão configurados para rodar via `ts-node` direto, então a compilação não é obrigatória.

---

### **4. Iniciar Novos Workers**

```bash
# Iniciar scheduler (cria jobs automáticos)
pm2 start ecosystem.config.js --only ifood-scheduler_worker

# Iniciar worker de settlements (se não estiver rodando)
pm2 start ecosystem.config.js --only ifood-settlements_worker

# Iniciar worker de anticipations
pm2 start ecosystem.config.js --only ifood-anticipations_worker

# Verificar status de todos os workers
pm2 list
```

---

### **5. Verificar Logs**

```bash
# Ver logs do scheduler
pm2 logs ifood-scheduler_worker --lines 50

# Ver logs do settlements
pm2 logs ifood-settlements_worker --lines 50

# Ver logs do anticipations
pm2 logs ifood-anticipations_worker --lines 50

# Ver logs do sales (verificar se continua funcionando)
pm2 logs ifood-sales_worker --lines 30
```

---

### **6. Salvar Configuração PM2**

```bash
# Salvar configuração atual do PM2
pm2 save

# Garantir que PM2 inicia automaticamente no boot
pm2 startup
```

---

## 📊 VERIFICAÇÃO FINAL

### **Status Esperado dos Workers**

```bash
pm2 list
```

**Resultado esperado:**

| id | name                        | status  | restarts | memory  |
|----|----------------------------|---------|----------|---------|
| 6  | dex-api                    | online  | ~34      | ~100mb  |
| 0  | ifood-scheduler_worker     | online  | 0        | ~50mb   |
| 1  | ifood-sales_worker         | online  | 0        | ~150mb  |
| 2  | ifood-settlements_worker   | online  | 0        | ~150mb  |
| 3  | ifood-anticipations_worker | online  | 0        | ~150mb  |

---

## 🧪 TESTES MANUAIS

### **1. Testar Scheduler (Criar Jobs Manualmente)**

```bash
# Conectar ao Supabase e inserir um job de teste
# Ou aguardar segunda-feira 8h / todo dia 6h para ver jobs sendo criados automaticamente
```

### **2. Testar Endpoint de Settlements**

```bash
curl -X POST http://localhost:3000/api/ifood/settlements \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "SEU_ACCOUNT_ID",
    "merchantId": "SEU_MERCHANT_ID",
    "ingest": true,
    "beginPaymentDate": "2025-12-01",
    "endPaymentDate": "2025-12-07"
  }'
```

### **3. Testar Endpoint de Anticipations**

```bash
curl -X POST http://localhost:3000/api/ifood/anticipations/sync \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "SEU_ACCOUNT_ID",
    "merchantId": "SEU_MERCHANT_ID"
  }'
```

---

## 🔍 TROUBLESHOOTING

### **Problema: Worker não inicia**

```bash
# Ver erro específico
pm2 logs <worker_name> --err --lines 100

# Verificar variáveis de ambiente
pm2 env <worker_id> | grep -E "SUPABASE|IFOOD"
```

### **Problema: Worker crashando**

```bash
# Ver últimos 100 erros
tail -n 100 /home/dex/dex-app/logs/worker-<nome>-error.log

# Reiniciar worker
pm2 restart <worker_name>
```

### **Problema: Jobs não sendo criados**

```bash
# Verificar se scheduler está rodando
pm2 logs ifood-scheduler_worker --lines 50

# Verificar tabela ifood_jobs no Supabase
# SELECT * FROM ifood_jobs WHERE job_type IN ('settlements_weekly', 'anticipations_daily') ORDER BY created_at DESC LIMIT 10;
```

---

## 📅 AGENDAMENTOS AUTOMÁTICOS

### **Scheduler Worker**
- **Roda:** A cada 1 minuto
- **Cria jobs:**
  - `settlements_weekly`: Segunda-feira às 8h
  - `anticipations_daily`: Todo dia às 6h

### **Workers de Processamento**
- **Rodam:** A cada 10 segundos (polling da fila)
- **Processam:** Jobs pendentes da tabela `ifood_jobs`

---

## ✅ CHECKLIST FINAL

- [ ] Workers obsoletos removidos
- [ ] Código atualizado (git pull)
- [ ] Novos workers iniciados
- [ ] Logs sem erros críticos
- [ ] PM2 configuração salva
- [ ] Testes manuais executados
- [ ] Monitoramento ativo

---

## 📞 PRÓXIMOS PASSOS

Após deploy bem-sucedido:

1. **Monitorar logs** nas próximas 24h
2. **Verificar jobs criados** na tabela `ifood_jobs`
3. **Validar dados salvos** em `ifood_payouts` e `ifood_anticipations`
4. **Implementar conciliação** (segunda fase)

---

**Data de criação:** 2025-12-11  
**Autor:** Cascade AI  
**Versão:** 1.0
