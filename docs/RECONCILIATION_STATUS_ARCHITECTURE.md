# Arquitetura de Status de Conciliação iFood

## 📋 Visão Geral

Sistema de rastreamento pedido-a-pedido do ciclo financeiro completo do iFood, desde a venda até o recebimento do pagamento.

## 🎯 Objetivo

Identificar automaticamente:
- ✅ Pedidos que foram pagos corretamente
- ⚠️ Pedidos com divergências de valor
- 🕐 Pedidos aguardando pagamento
- ❌ Pedidos cancelados/estornados
- 🔍 Pedidos que não aparecem na conciliação

## 🏗️ Arquitetura

### **Componentes Principais:**

```
┌─────────────────┐
│  ifood_sales    │  ← Vendas (Sales API)
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ ifood_reconciliation_calculator │  ← Lógica de negócio
└────────┬────────────────────────┘
         │
         ├──► ifood_conciliation  (Eventos Financeiros)
         ├──► ifood_settlements   (Repasses) [FASE 2]
         ├──► ifood_anticipations (Antecipações) [FASE 2]
         │
         ▼
┌──────────────────────────────────┐
│ ifood_order_reconciliation_status│  ← Status final
└──────────────────────────────────┘
```

### **Fluxo de Dados:**

1. **Sales API** → Tabela `ifood_sales` (já implementado)
2. **Reconciliation API** → Tabela `ifood_conciliation` (já implementado)
3. **Calculator Service** → Cruza dados e calcula status
4. **Status Table** → Armazena resultado da conciliação

## 📊 Estados (Status)

### **🟡 sales_only**
- **Condição**: Pedido existe em `ifood_sales` mas não em `ifood_conciliation`
- **Significado**: Venda registrada, mas ainda não apareceu no relatório financeiro
- **Ação**: Aguardar próximo relatório de conciliação

### **🔵 awaiting_settlement**
- **Condição**: Pedido conciliado, mas sem dados de pagamento
- **Significado**: iFood reconheceu a venda, aguardando repasse
- **Ação**: Aguardar data prevista de pagamento

### **🟢 reconciled**
- **Condição**: `|valor_pago - valor_esperado| ≤ R$ 0,10`
- **Significado**: Valores batem, tudo certo!
- **Ação**: Nenhuma, ciclo completo

### **🔴 divergent**
- **Condição**: Diferença de valor > R$ 0,10 OU atraso > 3 dias
- **Significado**: Algo está errado, precisa investigar
- **Ação**: Alerta para o usuário, análise manual

### **⚫ cancelled**
- **Condição**: Evento de cancelamento/estorno detectado
- **Significado**: Pedido foi cancelado
- **Ação**: Apenas informativo

## 🔧 Implementação Atual (FASE 1)

### ✅ **O que está funcionando:**

1. **Tabela de Status** (`ifood_order_reconciliation_status`)
   - Schema completo com todos os campos
   - Índices otimizados para consultas
   - RLS (Row Level Security) configurado

2. **Serviço de Cálculo** (`ifood-reconciliation-calculator.ts`)
   - ✅ Busca dados de `ifood_sales`
   - ✅ Busca dados de `ifood_conciliation`
   - ✅ Calcula status baseado em regras de negócio
   - ✅ Processamento em lotes (50 pedidos por vez)
   - ✅ Tratamento robusto de erros

3. **Worker Automático** (`ifood-reconciliation-status.worker.ts`)
   - Processa jobs da fila `ifood_jobs`
   - Retry automático com backoff exponencial
   - Máximo 3 tentativas por job
   - Timeout de 30 minutos por job

4. **Scheduler Diário** (`ifood-schedule-jobs.ts`)
   - Cria jobs de `reconciliation_status` automaticamente
   - Roda diariamente para todas as lojas ativas
   - Integrado com scheduler existente

5. **PM2 Configuration** (`ecosystem.config.js`)
   - Worker configurado para rodar em produção
   - Auto-restart em caso de falha
   - Logs separados por worker

### ⏳ **O que está pendente (FASE 2):**

1. **Settlements API** (Repasses)
   - Endpoint: `/api/ifood/settlements/sync`
   - Tabela: `ifood_settlements`
   - Integração com calculator

2. **Anticipations API** (Antecipações)
   - Endpoint: `/api/ifood/anticipations/sync`
   - Tabela: `ifood_anticipations`
   - Integração com calculator

### 📝 **O que está pendente (FASE 3):**

1. **Frontend - Tela de Conciliação**
   - Listagem de pedidos com status
   - Filtros por status
   - Drawer com detalhes financeiros
   - Dashboard com métricas

2. **Alertas Discord**
   - Webhook configurado
   - Notificações de divergências
   - Controle de spam

## 🎯 Regras de Negócio

### **Tolerâncias:**
- **Valor**: R$ 0,10 de diferença aceitável
- **Data**: 3 dias após data prevista antes de marcar como divergente

### **Cálculo de Valor Líquido:**
```typescript
net_from_reconciliation = SUM(transaction_value) 
  WHERE ifood_order_id = order_id
```

### **Detecção de Cancelamento:**
```typescript
is_cancelled = EXISTS(
  transaction_type LIKE '%cancel%' OR
  transaction_type LIKE '%estorno%' OR
  transaction_description LIKE '%cancel%' OR
  transaction_description LIKE '%estorno%'
)
```

## 🚀 Como Usar

### **1. Executar Migração SQL:**
```bash
# No Supabase Dashboard, executar:
supabase/migrations/20241126_create_ifood_order_reconciliation_status.sql
```

### **2. Iniciar Worker:**
```bash
cd dex-contabo
pm2 start ecosystem.config.js --only ifood-reconciliation-status_worker
```

### **3. Trigger Manual (Opcional):**
```bash
curl -X POST http://localhost:3000/api/ifood/reconciliation/calculate-status \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "uuid-da-loja",
    "merchantId": "merchant-id-ifood"
  }'
```

### **4. Verificar Resultados:**
```sql
SELECT 
  order_id,
  status,
  gross_from_sales,
  net_from_reconciliation,
  divergence_reason
FROM ifood_order_reconciliation_status
WHERE account_id = 'uuid-da-loja'
ORDER BY order_created_at DESC
LIMIT 100;
```

## 📊 Métricas Esperadas

### **Distribuição de Status (Estimativa):**
- 🟢 `reconciled`: ~85% (maioria dos pedidos)
- 🔵 `awaiting_settlement`: ~10% (aguardando repasse)
- 🟡 `sales_only`: ~3% (recém criados)
- 🔴 `divergent`: ~1% (problemas)
- ⚫ `cancelled`: ~1% (cancelamentos)

## 🔍 Troubleshooting

### **Problema: Todos os pedidos ficam em `sales_only`**
- **Causa**: Dados de conciliação não estão sendo ingeridos
- **Solução**: Verificar se o worker de conciliação está rodando e processando relatórios

### **Problema: Muitos pedidos em `divergent`**
- **Causa**: Tolerância muito baixa ou problema nos dados
- **Solução**: Revisar regras de tolerância ou investigar dados de origem

### **Problema: Worker não processa jobs**
- **Causa**: Fila `ifood_jobs` vazia ou worker parado
- **Solução**: Verificar scheduler e status do PM2

## 🎓 Próximos Passos

1. ✅ **FASE 1 COMPLETA** - Status básico funcionando
2. ⏳ **FASE 2** - Implementar Settlements + Anticipations
3. ⏳ **FASE 3** - Frontend + Alertas
4. ⏳ **FASE 4** - Otimizações e melhorias

## 📚 Referências

- [Documento de Conciliação iFood](./ifood-finance-conciliation.md)
- [API iFood - Reconciliation](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-reconciliation-ondemand/)
- [API iFood - Settlements](https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-settlements/)

---

**Última atualização**: 2024-11-26  
**Versão**: 1.0 (FASE 1)  
**Status**: ✅ Produção (parcial - aguardando FASE 2)
