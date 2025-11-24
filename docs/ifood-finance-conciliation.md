# Módulo Financeiro iFood no Dex  
_Versão inicial – visão de arquitetura e conciliação ponta‑a‑ponta_

## 1. Fluxo financeiro oficial do iFood

Fluxo conforme documentação do iFood:

1. **Sales (API de Vendas)**  
   - Lista as vendas/pedidos realizados pela loja.  
   - Foco em **dados do pedido**: itens, valores brutos, taxas visíveis, datas, canal, etc.  
   - Boa para visão operacional e analytics.

2. **Financial Events / Reconciliation (API de Eventos Financeiros / Conciliação)**  
   - Livro de eventos financeiros (créditos e débitos).  
   - Representa efeitos financeiros de cada pedido:
     - comissões, vouchers, cancelamentos, subsídios, ajustes diversos,
     - especialmente o evento que consolida o **valor líquido a receber** (ex.: `FINANCIAL_BILLED_ORDER_ENTRY` / `saleBalance`).
   - Inclui **datas previstas de pagamento** (ex.: D+7, D+30).

3. **Settlements (API de Liquidação / Repasses)**  
   - Informa **pagamentos efetivos** feitos à loja:
     - datas efetivas de pagamento,
     - valores líquidos por liquidação (pode ser a soma de vários pedidos / períodos),
     - taxas e ajustes por liquidação.

4. **Anticipations (API de Antecipação)**  
   - Informa recebíveis que foram **antecipados**:
     - quais pedidos / competências / recebíveis foram antecipados,
     - quanto foi antecipado,
     - quais taxas de antecipação foram cobradas.

**Resumo conceitual:**

```
Sales → Reconciliation → Settlements + Anticipations
  ↓           ↓                    ↓
Pedidos   Contas a Receber   Movimento de Caixa
```

- `Sales` → registro da venda.  
- `Reconciliation` → vira **contas a receber** (livro financeiro).  
- `Settlements + Anticipations` → **movimento de caixa real** (o que entrou na conta da loja).  

---

## 2. Arquitetura atual do Dex (iFood Finance)

### 2.1 Infra de jobs e workers

#### Tabelas Supabase (núcleo de jobs)

- **`ifood_schedules`**: agenda por loja (flags do tipo de job: conciliação, sales, etc.).
- **`ifood_jobs`**: fila de jobs diários (`job_type`, `account_id`, `merchant_id`, `competence`, etc.).

#### Scheduler diário

**Arquivo**: `api/cron/ifood-schedule-jobs.ts`

- Lido por um cron (via `CRON_SECRET`).
- Para cada loja em `ifood_schedules`:
  - Cria jobs idempotentes em `ifood_jobs`:
    - `job_type = 'conciliation'`
    - `job_type = 'sales_sync'` (quando `run_sales_sync = true`).
- Usa unique constraint para evitar duplicidade de job.

#### Workers Node.js

**1. `workers/ifood-conciliation.worker.ts`**

- Reserva jobs `job_type = 'conciliation'`.
- Chama `/api/ingest/ifood-reconciliation` com dados do job.
- Gerencia:
  - `reserved_at`, `attempts`, `status` (`pending`, `running`, `success`, `failed`),
  - retry com backoff exponencial,
  - logs detalhados.

**2. `workers/ifood-sales.worker.ts`**

- Reserva jobs `job_type = 'sales_sync'`.
- Calcula período com base em `ifood_sales_sync_status` (de onde parou até ontem).
- Chama `/api/ifood/sales/sync` com `accountId`, `merchantId`, `periodStart`, `periodEnd`.
- Atualiza status do job e de `ifood_sales_sync_status`.

**Configuração PM2**: `ecosystem.config.js`

```javascript
{
  name: 'ifood-conciliation_worker',
  script: 'workers/ifood-conciliation.worker.ts',
  interpreter: 'ts-node',
  env_file: '.env',
  // ...
},
{
  name: 'ifood-sales_worker',
  script: 'workers/ifood-sales.worker.ts',
  interpreter: 'ts-node',
  env_file: '.env',
  // ...
}
```

### 2.2 Sales Sync (vendas)

#### Endpoint principal

**Arquivo**: `api/ifood/sales/sync.ts` (`syncIfoodSales`)

#### Funcionalidade

1. Recebe `accountId`, `merchantId`, `periodStart`, `periodEnd`.
2. Quebra o período em **chunks de 7 dias**.
3. Para cada chunk:
   - Paginação na API de vendas (via proxy do Dex).
   - Trata resposta **404 "No sales found between …" como sucesso com 0 vendas**.
4. **Antes de salvar**:
   - **Limpa** `ifood_sales` para aquele `accountId + merchantId` no período:
     ```sql
     DELETE FROM ifood_sales
     WHERE account_id = $accountId
       AND merchant_id = $merchantId
       AND created_at >= $periodStart::timestamp
       AND created_at <= $periodEnd::timestamp + '23:59:59.999'::interval;
     ```
5. Em seguida **salva** as novas vendas (`saveSales` → upsert).

#### Tabelas relevantes

- **`ifood_sales`**: tabela detalhada de vendas (pedidos).
  - Campos principais: `order_id`, `merchant_id`, `account_id`, `created_at`, `bag_value`, `delivery_fee`, `payment_method`, etc.

- **`ifood_sales_sync_status`**: status da sincronização de vendas por período.
  - Campos: `account_id`, `merchant_id`, `period_start`, `period_end`, `status`, `total_sales`, `last_error`, timestamps.
  - Status possíveis: `pending`, `running`, `completed`, `failed`.

#### Comportamento "clean before load"

- Garante que cada sync **substitui completamente** os dados do período.
- Evita duplicatas e estados inconsistentes.
- Idempotente: rodar múltiplas vezes para o mesmo período sempre resulta no mesmo estado final.

### 2.3 Conciliação (Reconciliation / Financial Events)

#### Entry points Node.js

- **`api/ifood/reconciliation/ingest.ts`** (+ `index.ts`)

#### Fluxo (alto nível)

1. Obtém token iFood.
2. Solicita relatório/arquivo de conciliação (CSV).
3. Faz polling até estar pronto.
4. Baixa o arquivo, descompacta, salva em storage.
5. Dispara processamento Python:
   - Interpreta o CSV de Financial Events,
   - Grava dados normalizados no Supabase (tabelas financeiras internas),
   - Usa `SupabaseLogger` para logar no `logs` (ou tabela específica de conciliação).

#### Status

- **`ifood_conciliation_runs`** (ou equivalente):
  - Campos: `account_id`, `merchant_id`, `competence` (ou data/período), `status`, metadados de execução, erros.
  - Status possíveis: `success`, `failed`, `running`.

**Conceito**: esta camada é o **livro de fluxo de caixa** (base para contas a receber e conferência de repasses).

### 2.4 Repasses (Settlements)

#### Endpoint

**Arquivo**: `api/ifood/financial/payouts-unified.ts`

#### Objetivo

- Unificar dados de repasse/settlements (pode puxar mais de uma fonte do iFood e consolidar).
- Servir o front / relatórios com uma visão consolidada de repasses.

#### Tabelas

- Estrutura para payouts/unified em Supabase (nome exato depende do schema atual).

#### Status (planejado)

- Idealmente teremos uma tabela de status por período, similar a `ifood_sales_sync_status`:
  - **`ifood_payouts_sync_status`** (a ser criada).

### 2.5 Antecipações (Anticipation)

**Status**: Ainda **não implementado** na stack Dex.

#### Planejamento

- Criar um fluxo semelhante:
  - Endpoint de ingest → tabela `ifood_anticipations`,
  - Tabela de status `ifood_anticipations_sync_status`,
  - Ligação com os recebíveis (FBOEs) da conciliação.

---

## 3. O que é um "ciclo financeiro completo conciliado"

Pensando em **loja + pedido**:

### Camadas do ciclo

1. **Camada 1 – Vendas (Sales)**  
   - Pedido existe em `ifood_sales`.

2. **Camada 2 – Fluxo de Caixa (Conciliação)**  
   - O mesmo pedido aparece no CSV/Financial Events:
     - com seus créditos, débitos, descontos, estornos, subsídios etc.
     - gerando um **valor líquido a receber** e uma **data prevista de pagamento**.

3. **Camada 3 – Pagamento (Settlements + Anticipations)**  
   - A soma de repasses + antecipações associados a esse pedido/recebível:
     - **é igual ao valor líquido esperado** (dentro de uma tolerância),
     - as datas de pagamento respeitam (ou antecipam) as datas previstas.

### Definição prática

> Um pedido está "totalmente conciliado" quando:
> - foi vendido (Sales),
> - tem seu registro financeiro na Conciliação,
> - e os repasses/antecipações já liquidaram aquilo que era esperado receber.

### Importante

- Isso **não exige esperar o mês fechar**.  
- Você pode conciliar **pedido a pedido**, usando:
  - a *data prevista de pagamento* da conciliação,
  - e, após essa data + tolerância, verificar se o pagamento bateu.

---

## 4. Conciliação pedido‑a‑pedido (modelo proposto)

### 4.1 Tabela de status por pedido

**Tabela sugerida**: `ifood_order_reconciliation_status`

#### Campos principais (conceito)

**Identificação**
- `account_id` (UUID)
- `merchant_id` (TEXT)
- `order_id` (TEXT) – chave primária junto com account/merchant
- `order_created_at` (TIMESTAMP)

**Vendas**
- `gross_from_sales` (DECIMAL) – valor bruto do pedido em `ifood_sales`
- Outros metadados úteis (canal, tipo de pedido, etc. – opcional).

**Conciliação**
- `net_from_reconciliation` (DECIMAL) – valor líquido esperado
- `expected_payment_date` (DATE ou TIMESTAMP) – ou intervalo de datas, caso parcelado
- `is_cancelled` (BOOLEAN) – flags de cancelamento/estorno

**Pagamentos**
- `total_paid` (DECIMAL) – somatório das liquidações e antecipações ligadas a esse pedido/recebível
- `first_payment_date` (DATE)
- `last_payment_date` (DATE) – quando houver múltiplos repasses

**Status de conciliação**
- `status` (TEXT/ENUM):
  - `sales_only` – tem venda, não apareceu na conciliação ainda
  - `awaiting_settlement` – conciliado no fluxo de caixa, aguardando repasse
  - `reconciled` – valores pagos batem com o esperado
  - `divergent` – diferença de valor ou ausência de pagamento após data prevista
  - `cancelled` – pedido cancelado/estornado
- `divergence_reason` (TEXT/JSONB) – motivo ou detalhes
- `last_checked_at` (TIMESTAMP)

**Timestamps**
- `created_at`
- `updated_at`

### 4.2 Regras de transição de status (simplificadas)

#### 1. `sales_only`

**Criado quando**:
- Pedido entra em `ifood_sales`,
- Mas ainda não há correspondência na conciliação.

#### 2. `awaiting_settlement`

**Quando**:
- Encontramos o pedido na conciliação:
  - Preenchemos `net_from_reconciliation` + `expected_payment_date`,
  - Ainda não há (ou não bastam) repasses/antecipações.

#### 3. `reconciled`

**Quando**:
- `total_paid` ≈ `net_from_reconciliation` (diferença ≤ tolerância em centavos),
- Todos os recebíveis desse pedido foram liquidados.

#### 4. `divergent`

**Quando**, após **`expected_payment_date + N dias de tolerância`** (por ex. D+3):
- Não há pagamento; ou
- `|total_paid - net_from_reconciliation| > tolerância`.

#### 5. `cancelled`

**Quando**:
- Conciliação indica que a venda foi cancelada/estornada,
- Não há expectativa de recebimento.

### 4.3 Job de recálculo

Um *job* recorrente (ou parte dos pipelines de ingest) recalcula esses campos e atualiza o `status` em `ifood_order_reconciliation_status`.

**Gatilhos**:
- Após ingest de Sales
- Após ingest de Reconciliation
- Após ingest de Settlements/Anticipations
- Job diário de recálculo

---

## 5. Resumo por competência/loja (visão macro)

Além da visão por pedido, faz sentido ter um resumo por **loja + competência (mês)**.

### Tabela sugerida: `ifood_financial_summary`

#### Campos principais (conceito)

- `account_id` (UUID)
- `merchant_id` (TEXT)
- `competence` (TEXT) – formato YYYY-MM
- `gross_sales` (DECIMAL) – soma de vendas brutas em `ifood_sales` no período
- `net_from_reconciliation` (DECIMAL) – soma dos valores líquidos a receber
- `total_paid` (DECIMAL) – repasses efetivamente pagos
- `total_anticipated` (DECIMAL) – valores antecipados
- `delta_financial` (DECIMAL) – calculado como:
  ```
  net_from_reconciliation - (total_paid + total_anticipated - taxas_de_antecipacao)
  ```
- `is_fully_reconciled` (BOOLEAN) – se `|delta_financial| <= tolerância`

**Flags de completude de dados**:
- `sales_sync_complete` (BOOLEAN)
- `reconciliation_complete` (BOOLEAN)
- `payouts_sync_complete` (BOOLEAN)
- `anticipations_sync_complete` (BOOLEAN)

**Timestamps**:
- `created_at`
- `updated_at`

### Uso

- "Até qual competência o Dex garante conciliação 100%?"
- Tela de dashboard financeiro com:
  - Status do mês (OK / divergente / incompleto),
  - Valores agregados.

---

## 6. Experiência de produto (front) e camada humana

### 6.1 Tela pedido‑a‑pedido

#### Colunas básicas

Para cada pedido (linha):

- Data/hora do pedido
- Canal
- Número do pedido (`order_id`)
- Valor bruto (Sales)
- Valor líquido esperado (Reconciliation)
- Valor pago (Settlements + Anticipations)
- **Status** (cor + label)

#### Status visíveis

- 🟡 `Pendente conciliação` (sales_only)
- 🔵 `Conciliado no fluxo de caixa / aguardando repasse` (awaiting_settlement)
- 🟢 `Conciliado` (reconciled)
- 🔴 `Divergente` (divergent)
- ⚫ `Cancelado/Estornado` (cancelled)

#### Filtros

- Por status
- Por data do pedido ou competência
- Por valores divergentes (apenas divergentes)
- Por loja/merchant

#### Detalhe do pedido (drawer/modal)

- Eventos da conciliação (créditos/débitos)
- Previsão de pagamento
- Repasses/antecipações ligados
- Explicação do porquê do status atual
- Histórico de mudanças de status

### 6.2 Layer humana + Discord

#### Gatilhos automáticos para Discord

**Quando disparar**:
- Quando algum registro vai para `divergent`
- Quando permanece `awaiting_settlement` **X dias depois** de `expected_payment_date`

#### Payload típico da mensagem

```
🚨 Divergência de Conciliação Detectada

Loja: [Nome da Loja]
Merchant ID: [merchant_id]
Pedido: [order_id]
Data do pedido: [order_created_at]

Valor esperado: R$ [net_from_reconciliation]
Valor pago: R$ [total_paid]
Diferença: R$ [delta]

Data prevista de pagamento: [expected_payment_date]
Status: DIVERGENTE

🔗 Ver detalhes: [link para o Dex]
```

#### Papel da pessoa humana

**Conferir divergências e decidir se é**:
- Bug de integração
- Atraso normal de banco
- Erro do iFood
- Caso para abrir chamado/ticket
- Eventualmente gerar pedidos manuais para o iFood em caso de falha

### Proposta de valor Dex

> Automatizar 90% da conciliação e deixar os 10% mais críticos para conferência humana, com contexto rico e alertas pró‑ativos.

---

## 7. Próximas etapas de implementação

Organizado em blocos práticos para retomar na segunda-feira.

### 7.1 Núcleo de conciliação pedido‑a‑pedido

- [ ] **Criar migração Supabase** para `ifood_order_reconciliation_status`
  - Definir schema completo
  - Criar índices apropriados
  - Configurar RLS policies

- [ ] **Implementar serviço de cálculo de status** (Node ou Python)
  - Para cada pedido em `ifood_sales`:
    - Localizar eventos correspondentes na conciliação
    - Calcular `net_from_reconciliation` e `expected_payment_date`
    - Relacionar repasses/antecipações
    - Preencher `total_paid`
    - Atualizar `status` conforme regras de transição

- [ ] **Criar job agendado** (scheduler/worker)
  - Recalcular status diariamente
  - Executar após novas ingests (sales / reconciliation / payouts / antecipations)
  - Implementar retry logic e error handling

### 7.2 Resumo financeiro por competência/loja

- [ ] **Criar tabela/visão** `ifood_financial_summary`
  - Definir schema
  - Criar índices
  - Configurar RLS

- [ ] **Implementar job de agregação**
  - Por competência:
    - Agregar `gross_sales`, `net_from_reconciliation`, `total_paid`, `total_anticipated`
    - Calcular `delta_financial` e `is_fully_reconciled`
    - Marcar flags de completude de dados

- [ ] **Expor endpoint** para o front consumir esse resumo
  - `GET /api/ifood/financial/summary?accountId=X&competence=YYYY-MM`
  - Incluir filtros e paginação

### 7.3 Antecipações (quando for o momento)

- [ ] **Implementar ingest da API de Anticipation**
  - Criar endpoint de sync
  - Criar tabela `ifood_anticipations`
  - Criar tabela de status `ifood_anticipations_sync_status`
  - Implementar worker (similar aos existentes)

- [ ] **Integrar dados de antecipação**
  - Ao cálculo de `total_paid`
  - Ao cálculo de `delta_financial`
  - À lógica de status de conciliação

### 7.4 Frontend – tela pedido‑a‑pedido

- [ ] **Criar rota/tela**: "Conciliação por Pedido iFood"
  - Estrutura de página
  - Navegação

- [ ] **Implementar listagem de pedidos**
  - Tabela com colunas descritas na seção 6.1
  - Filtros (status, data, valores)
  - Paginação
  - Ordenação

- [ ] **Implementar detalhe/drawer**
  - Eventos da conciliação
  - Previsão e realização de pagamento
  - Histórico de status
  - Ações disponíveis

- [ ] **Implementar dashboard de resumo**
  - Cards com métricas principais
  - Gráficos de evolução
  - Alertas de divergências

### 7.5 Integração Discord / alertas

- [ ] **Configurar webhooks do Discord**
  - Definir canais
  - Obter URLs de webhook
  - Armazenar em variáveis de ambiente

- [ ] **Implementar serviço de notificação**
  - Função para enviar mensagens ao Discord
  - Templates de mensagens
  - Formatação rica (embeds)

- [ ] **Implementar gatilhos de alerta**
  - Disparar quando `status` muda para `divergent`
  - Disparar quando `awaiting_settlement` expira pela tolerância
  - Incluir contexto suficiente (loja, pedido, valores, datas, link)

- [ ] **Implementar controle de frequência**
  - Evitar spam de notificações
  - Agrupar alertas similares
  - Implementar cooldown por pedido

---

## 8. Considerações técnicas importantes

### 8.1 Tolerâncias e thresholds

- **Tolerância de valor**: definir diferença aceitável entre esperado e pago (ex: R$ 0.10)
- **Tolerância de data**: dias após `expected_payment_date` antes de marcar como divergente (ex: 3 dias)
- **Cooldown de alertas**: tempo mínimo entre alertas do mesmo pedido (ex: 24h)

### 8.2 Performance

- **Índices críticos**:
  - `ifood_order_reconciliation_status`: (account_id, merchant_id, status)
  - `ifood_order_reconciliation_status`: (expected_payment_date, status)
  - `ifood_financial_summary`: (account_id, competence)

- **Jobs de recálculo**:
  - Processar em batches
  - Implementar checkpoints para retomada
  - Monitorar tempo de execução

### 8.3 Observabilidade

- **Logs estruturados**:
  - Usar `SupabaseLogger` ou equivalente
  - Incluir trace_id em todas as operações
  - Logar mudanças de status

- **Métricas**:
  - Contadores por status
  - Taxa de divergências
  - Tempo médio de conciliação
  - SLA de processamento

### 8.4 Segurança

- **RLS (Row Level Security)**:
  - Garantir que usuários só vejam dados de suas lojas
  - Políticas específicas por tabela

- **API Keys**:
  - Rotação periódica
  - Armazenamento seguro (variáveis de ambiente)
  - Logs de acesso

---

## 9. Glossário

- **FBOE**: Financial Billed Order Entry – evento de conciliação que representa o valor líquido a receber de um pedido
- **Competência**: período mensal de referência (formato YYYY-MM)
- **Settlement**: repasse/liquidação – pagamento efetivo do iFood para a loja
- **Anticipation**: antecipação de recebíveis – pagamento antecipado de valores futuros
- **Reconciliation**: conciliação – processo de verificar que vendas, fluxo de caixa e pagamentos estão alinhados
- **RLS**: Row Level Security – segurança em nível de linha no Supabase
- **Clean before load**: estratégia de deletar dados existentes antes de inserir novos para garantir consistência

---

## 10. Referências

- [Documentação oficial iFood - APIs Financeiras](https://developer.ifood.com.br/)
- `dex-contabo/docs/ifood-jobs-architecture.md` – arquitetura de jobs e workers
- `dex-contabo/workers/ifood-conciliation.worker.ts` – implementação do worker de conciliação
- `dex-contabo/workers/ifood-sales.worker.ts` – implementação do worker de vendas
- `dex-contabo/api/ifood/sales/sync.ts` – endpoint de sincronização de vendas
- `dex-contabo/api/ifood/reconciliation/ingest.ts` – endpoint de ingestão de conciliação

---

**Última atualização**: 2024-11-22  
**Autor**: Equipe Dex  
**Status**: Documento de planejamento – implementação em andamento
