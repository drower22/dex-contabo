# 🔍 AUDITORIA COMPLETA: ENDPOINTS IFOOD

## 🎯 OBJETIVO
Testar manualmente cada endpoint do pipeline **Vendas → Repasses → Antecipações** e validar integridade dos dados no Supabase.

---

## 📋 PRÉ-REQUISITOS

### **1. Dados Necessários**
Você vai precisar de:
- `account_id` (ID interno da conta no Supabase)
- `merchant_id` (ID do merchant no iFood)
- Token válido (gerado automaticamente pelos endpoints)

### **2. Ferramentas**
- `curl` (linha de comando)
- Acesso ao Supabase (para validar dados salvos)
- Logs do PM2 (para debug)

---

## 🧪 TESTES POR MÓDULO

---

## **1️⃣ VENDAS (Sales)**

### **Endpoint: Listar Vendas**

```bash
curl -X GET "http://localhost:3000/api/ifood/sales?merchantId=SEU_MERCHANT_ID&page=1&size=20" \
  -H "Accept: application/json"
```

**Resposta esperada:**
```json
{
  "data": [
    {
      "id": "...",
      "orderId": "...",
      "createdAt": "...",
      "totalValue": 100.50,
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "size": 20,
    "total": 150
  }
}
```

**Validação no Supabase:**
```sql
SELECT COUNT(*) FROM ifood_sales WHERE merchant_id = 'SEU_MERCHANT_ID';
```

---

### **Endpoint: Sync Manual de Vendas**

```bash
curl -X POST http://localhost:3000/api/ifood/sales/sync \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "SEU_ACCOUNT_ID",
    "merchantId": "SEU_MERCHANT_ID",
    "startDate": "2025-12-01",
    "endDate": "2025-12-11"
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Sync de vendas iniciado",
  "jobId": "uuid-do-job"
}
```

**Validação:**
1. Verificar job criado:
```sql
SELECT * FROM ifood_jobs WHERE id = 'uuid-do-job';
```

2. Aguardar processamento (worker processa em até 10s)

3. Verificar vendas salvas:
```sql
SELECT COUNT(*) FROM ifood_sales 
WHERE merchant_id = 'SEU_MERCHANT_ID' 
AND created_at BETWEEN '2025-12-01' AND '2025-12-11';
```

---

## **2️⃣ REPASSES (Settlements)**

### **Endpoint: Listar Settlements**

```bash
curl -X GET "http://localhost:3000/api/ifood/financial/settlements?merchantId=SEU_MERCHANT_ID" \
  -H "Accept: application/json"
```

**Resposta esperada:**
```json
{
  "data": [
    {
      "id": "...",
      "settlementId": "...",
      "paymentDate": "2025-12-09",
      "totalValue": 5000.00,
      ...
    }
  ]
}
```

---

### **Endpoint: Sync Manual de Settlements**

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

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Settlements processados com sucesso",
  "processedItems": 5,
  "dbSavedItems": 5
}
```

**Validação no Supabase:**
```sql
SELECT * FROM ifood_payouts 
WHERE merchant_id = 'SEU_MERCHANT_ID' 
AND payment_date BETWEEN '2025-12-01' AND '2025-12-07'
ORDER BY payment_date DESC;
```

---

## **3️⃣ ANTECIPAÇÕES (Anticipations)**

### **Endpoint: Listar Antecipações**

```bash
curl -X GET "http://localhost:3000/api/ifood/financial/anticipations?merchantId=SEU_MERCHANT_ID" \
  -H "Accept: application/json"
```

**Resposta esperada:**
```json
{
  "data": [
    {
      "id": "...",
      "anticipationId": "...",
      "requestDate": "2025-12-10",
      "anticipatedValue": 2000.00,
      ...
    }
  ]
}
```

---

### **Endpoint: Sync Manual de Antecipações**

```bash
curl -X POST http://localhost:3000/api/ifood/anticipations/sync \
  -H "Content-Type: application/json" \
  -d '{
    "storeId": "SEU_ACCOUNT_ID",
    "merchantId": "SEU_MERCHANT_ID"
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Antecipações sincronizadas com sucesso",
  "savedCount": 3
}
```

**Validação no Supabase:**
```sql
SELECT * FROM ifood_anticipations 
WHERE merchant_id = 'SEU_MERCHANT_ID' 
ORDER BY request_date DESC
LIMIT 10;
```

---

## **4️⃣ PAYOUTS UNIFICADOS**

### **Endpoint: Listar Payouts (Repasses + Antecipações)**

```bash
curl -X GET "http://localhost:3000/api/ifood/financial/payouts-unified?merchantId=SEU_MERCHANT_ID&startDate=2025-12-01&endDate=2025-12-11" \
  -H "Accept: application/json"
```

**Resposta esperada:**
```json
{
  "data": [
    {
      "id": "...",
      "type": "settlement",
      "date": "2025-12-09",
      "value": 5000.00,
      ...
    },
    {
      "id": "...",
      "type": "anticipation",
      "date": "2025-12-10",
      "value": 2000.00,
      ...
    }
  ],
  "summary": {
    "totalSettlements": 5000.00,
    "totalAnticipations": 2000.00,
    "total": 7000.00
  }
}
```

---

## **5️⃣ MERCHANT INFO**

### **Endpoint: Informações do Merchant**

```bash
curl -X GET "http://localhost:3000/api/ifood/merchant?merchantId=SEU_MERCHANT_ID" \
  -H "Accept: application/json"
```

**Resposta esperada:**
```json
{
  "id": "SEU_MERCHANT_ID",
  "name": "Nome do Restaurante",
  "corporateName": "Razão Social",
  "status": "AVAILABLE",
  ...
}
```

---

## 📊 VALIDAÇÃO DE INTEGRIDADE DE DADOS

### **1. Verificar Vendas vs Repasses**

```sql
-- Total de vendas no período
SELECT 
  SUM(total_value) as total_vendas,
  COUNT(*) as qtd_vendas
FROM ifood_sales 
WHERE merchant_id = 'SEU_MERCHANT_ID' 
AND created_at BETWEEN '2025-12-01' AND '2025-12-07';

-- Total de repasses no período
SELECT 
  SUM(total_value) as total_repasses,
  COUNT(*) as qtd_repasses
FROM ifood_payouts 
WHERE merchant_id = 'SEU_MERCHANT_ID' 
AND payment_date BETWEEN '2025-12-01' AND '2025-12-07';

-- Diferença (deve ser próxima de 0, considerando taxas)
-- total_vendas - taxas - total_repasses ≈ 0
```

---

### **2. Verificar Jobs Pendentes**

```sql
-- Jobs pendentes (não devem acumular)
SELECT job_type, status, COUNT(*) 
FROM ifood_jobs 
GROUP BY job_type, status;

-- Jobs com erro (investigar)
SELECT * FROM ifood_jobs 
WHERE status = 'failed' 
ORDER BY updated_at DESC 
LIMIT 10;
```

---

### **3. Verificar Logs de Erro**

```bash
# Ver erros recentes de cada worker
pm2 logs ifood-sales_worker --err --lines 50
pm2 logs ifood-settlements_worker --err --lines 50
pm2 logs ifood-anticipations_worker --err --lines 50
pm2 logs ifood-scheduler_worker --err --lines 50
```

---

## 🚨 PROBLEMAS COMUNS E SOLUÇÕES

### **Erro: "No valid financial token found"**

**Causa:** Token expirado ou não configurado

**Solução:**
1. Verificar se a conta tem token válido no Supabase:
```sql
SELECT * FROM ifood_tokens WHERE account_id = 'SEU_ACCOUNT_ID';
```

2. Se não tiver, fazer novo fluxo de autorização OAuth

---

### **Erro: "fetch failed" ou "ECONNREFUSED"**

**Causa:** API do iFood fora do ar ou proxy com problema

**Solução:**
1. Testar conectividade direta:
```bash
curl -I https://merchant-api.ifood.com.br
```

2. Verificar variáveis de ambiente:
```bash
pm2 env 6 | grep IFOOD
```

---

### **Erro: Jobs acumulando na fila**

**Causa:** Worker não está processando ou está crashando

**Solução:**
1. Verificar se worker está rodando:
```bash
pm2 list | grep worker
```

2. Ver logs do worker:
```bash
pm2 logs <worker_name> --lines 100
```

3. Reiniciar worker:
```bash
pm2 restart <worker_name>
```

---

## ✅ CHECKLIST DE AUDITORIA

### **Vendas**
- [ ] Endpoint de listagem funciona
- [ ] Endpoint de sync cria job
- [ ] Worker processa job
- [ ] Dados salvos no Supabase
- [ ] Logs sem erros críticos

### **Settlements**
- [ ] Endpoint de listagem funciona
- [ ] Endpoint de sync funciona
- [ ] Dados salvos no Supabase
- [ ] Valores batem com vendas (considerando taxas)

### **Anticipations**
- [ ] Endpoint de listagem funciona
- [ ] Endpoint de sync funciona
- [ ] Dados salvos no Supabase

### **Workers**
- [ ] Scheduler cria jobs automaticamente
- [ ] Sales worker processa vendas
- [ ] Settlements worker processa repasses
- [ ] Anticipations worker processa antecipações
- [ ] Nenhum worker crashando

### **Integridade**
- [ ] Vendas vs Repasses batem (com margem de erro de taxas)
- [ ] Não há jobs acumulados na fila
- [ ] Logs sem erros recorrentes

---

## 📅 CRONOGRAMA DE TESTES

### **Dia 1: Testes Básicos**
- Testar cada endpoint manualmente
- Validar dados salvos no Supabase
- Verificar logs dos workers

### **Dia 2: Testes de Integração**
- Criar jobs manualmente e ver workers processando
- Validar integridade de dados (vendas vs repasses)
- Monitorar performance dos workers

### **Dia 3: Testes de Agendamento**
- Aguardar scheduler criar jobs automaticamente
- Verificar se workers processam jobs agendados
- Validar dados salvos automaticamente

---

**Data de criação:** 2025-12-11  
**Autor:** Cascade AI  
**Versão:** 1.0
