# Arquitetura de Jobs iFood (Conciliação + Futuros Jobs)

## 1. Objetivo

Padronizar como rodamos tarefas recorrentes do iFood (conciliação hoje, sales depois) para **todas as contas** de forma:

- escalável (até ~1000 contas/dia),
- resiliente a falhas / rate limit do iFood,
- observável (centralizando logs no Supabase),
- fácil de estender com novos tipos de job.

A arquitetura é composta por:

- Tabelas de **schedule** e **fila de jobs** no Supabase.
- Um **scheduler diário** rodando no Contabo (cron + script Node).
- Um ou mais **workers** em Node (PM2) que consomem a fila e chamam os serviços existentes (conciliação, sales, etc.).

---

## 2. Tabelas no Supabase

### 2.1. `public.ifood_schedules`

Uma linha por conta/loja que deve participar de jobs automáticos do iFood.

Campos principais (conceito):

- `account_id uuid PK` – referencia `accounts.id`.
- `merchant_id text` – merchant do iFood.
- `enabled boolean` – se participa da rotina.
- `timezone text` – hoje, usamos `America/Sao_Paulo` para todas.
- `preferred_hour time` – horário local alvo; por padrão `03:00:00`.
- `run_conciliation boolean` – se essa conta roda job de conciliação.
- `run_sales_sync boolean` – se essa conta roda job de sales (futuro).
- `last_conciliation_run_at timestamptz`, `last_conciliation_status text`.
- `last_sales_sync_run_at timestamptz`, `last_sales_sync_status text`.
- `created_at`, `updated_at` – mantidos por trigger `set_timestamp()`.

Uso:

- O scheduler diário lê essa tabela para decidir quais contas devem receber jobs em `ifood_jobs`.
- No futuro, podemos adicionar mais flags por tipo de job sem quebrar nada.

### 2.2. `public.ifood_jobs`

Fila unificada de jobs do iFood.

Campos principais:

- `id uuid PK` – identificador do job.
- `job_type text` – tipo do job. Hoje planejados:
  - `'conciliation'` – conciliação financeira (usa fluxo atual de ingest + Python).
  - `'sales_sync'` – sync de vendas (será implementado depois).
- `account_id uuid` – conta Dex (`accounts.id`).
- `merchant_id text` – merchant iFood.
- `competence text` – competência `YYYY-MM` (usada por conciliação; pode ficar `NULL` para outros jobs).
- `scheduled_for timestamptz` – quando esse job deveria começar a ser elegível.
- `status text` – estado do job:
  - `pending`  – aguardando execução.
  - `running`  – em execução por algum worker.
  - `success`  – concluído com sucesso.
  - `error`    – falhou mas ainda será re-tentado.
  - `failed`   – falhou definitivamente após todas tentativas.
- `attempts int` – quantas tentativas já foram feitas.
- `next_retry_at timestamptz` – quando esse job volta a ficar elegível (para backoff exponencial, etc.).
- `last_error text` – mensagem resumida da última falha.
- `run_id uuid` – referencia:
  - para conciliação: `ifood_conciliation_runs.id`.
  - para sales: no futuro, `ifood_sales_sync_status.id`.
- `trace_id uuid` – correlação de logs em `logs`.
- `locked_at timestamptz`, `locked_by text` – marcadores opcionais de "lock" de worker.
- `created_at`, `updated_at` – mantidos por trigger `set_timestamp()`.

Índices / constraints importantes:

- `ifood_jobs_pending_idx (status, scheduled_for, coalesce(next_retry_at, scheduled_for))` – facilita buscar jobs pendentes ordenados por prioridade.
- `ifood_jobs_unique_conciliation (job_type, account_id, competence) where job_type = 'conciliation'` – garante **no máximo 1 job de conciliação por account + competência**.

Para sales_sync diário, a unicidade será garantida inicialmente pela aplicação; se necessário, podemos adicionar uma coluna `job_day date` dedicada para facilitar o índice único sem funções.

---

## 3. Fluxo Diário (às 03:00)

### 3.1. Scheduler diário no Contabo (cron)

- Um script Node (ex.: `scripts/schedule-ifood-jobs.ts`) roda **uma vez por dia às 03:00 BRT**.
- Esse script é disparado via `cron` do Linux no Contabo, algo como:

  ```cron
  0 3 * * * cd /home/dex/dex-app && /usr/bin/node dist/scripts/schedule-ifood-jobs.js >> /var/log/dex-scheduler.log 2>&1
  ```

  (ajustar horas conforme timezone/configuração do servidor; se o servidor estiver em UTC, usar `6 0 * * *` para equivaler a 03:00 BRT, etc.).

### 3.2. Responsabilidade do script `schedule-ifood-jobs`

1. Conectar no Supabase com `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. Descobrir a **competência alvo** de conciliação (por exemplo, mês corrente `YYYY-MM`).
3. Ler `ifood_schedules`:
   - `enabled = true`.
   - `run_conciliation = true` (para jobs de conciliação).
   - (no futuro) `run_sales_sync = true` para jobs de sales.
4. Para cada linha:
   - Gerar jobs de conciliação:

     ```sql
     insert into public.ifood_jobs (
       job_type,
       account_id,
       merchant_id,
       competence,
       scheduled_for,
       status
     ) values ('conciliation', account_id, merchant_id, competence, now(), 'pending')
     on conflict (job_type, account_id, competence) do nothing;
     ```

   - (No futuro) gerar job `sales_sync` para o dia/período desejado.

Resultado esperado:

- Após a execução diária, a tabela `ifood_jobs` terá **até 1 job de conciliação por account + competência**.
- Nenhum job duplicado é criado graças ao `ON CONFLICT`.

---

## 4. Worker de Fila (`dex-worker`)

Será um processo Node (rodando via PM2 no Contabo) responsável por consumir `ifood_jobs` e chamar os serviços existentes.

### 4.1. Loop principal

1. A cada X segundos (ex.: 5–10s):

   - Buscar um lote de jobs prontos para processamento:

     - `status = 'pending'`.
     - `scheduled_for <= now()`.
     - `next_retry_at IS NULL OR next_retry_at <= now()`.
     - Limitado por um `N` configurável (ex.: 5 ou 10) para controlar concorrência.

   - Opcionalmente, usar `for update skip locked` (numa RPC ou função SQL) para evitar que múltiplos workers peguem o mesmo job ao mesmo tempo.

2. Marcar esses jobs como `running`, preenchendo `locked_at` e `locked_by`.
3. Para cada job, chamar o executor específico por `job_type`.

### 4.2. Execução por tipo de job

- `job_type = 'conciliation'`:
  - O worker chama a mesma lógica que hoje já existe no `dex-contabo/api/ifood/reconciliation/ingest.ts` (pode ser via HTTP no endpoint `/api/ingest/ifood-reconciliation` ou extraindo o core para um serviço reutilizável).
  - Parâmetros típicos:
    - `merchantId` = `merchant_id`.
    - `storeId` = `account_id`.
    - `competence` = campo do job.
    - `triggerSource = 'scheduler'`.
  - O handler Node atual já faz:
    - autenticação no iFood (edge function),
    - request + polling do relatório,
    - download/descompactação do CSV,
    - upload para Storage,
    - registro em `received_files`,
    - disparo do backend Python,
    - logging central em `ifood_conciliation_runs` e `logs`.

- `job_type = 'sales_sync'` (futuro):
  - O worker chamará o serviço em `src/modules/ifood-sales/api` / `services/ifood-sales-sync.service.ts` para sincronizar vendas de um período definido (provavelmente dia anterior), também com logging central.

### 4.3. Atualização de status, retries e backoff

Após cada execução:

- **Sucesso**:
  - `status = 'success'`.
  - `attempts = attempts + 1`.
  - `last_error = NULL`.
  - `locked_at/locked_by` limpos (ou mantidos para histórico).
  - Atualizar em `ifood_schedules.last_conciliation_run_at` / `last_conciliation_status` (ou campos equivalentes para sales), para a conta correspondente.

- **Erro retryable** (ex.: timeout de rede, HTTP 5xx, 429 do iFood):
  - `status` volta para `'pending'`.
  - `attempts = attempts + 1`.
  - `next_retry_at = now() + backoff` (p.ex., 15 → 30 → 60 minutos).
  - `last_error` recebe um resumo.
  - Se `attempts` ultrapassar `MAX_ATTEMPTS` (ex.: 3), marcar como `'failed'` ao invés de voltar para `'pending'`.

- **Erro não retryable** (ex.: credenciais inválidas, merchant removido, configuração incorreta):
  - `status = 'failed'` direto.
  - `attempts = attempts + 1`.
  - `next_retry_at = NULL`.
  - `last_error` descreve o problema.

Essa lógica é compartilhada entre todos os tipos de job, o que simplifica manutenção.

### 4.4. Controle de concorrência / rate limit iFood

- O número `N` de jobs processados em paralelo controla o **limite global de concorrência**. Por exemplo:
  - `N = 10` → no máximo 10 conciliações/sales rodando ao mesmo tempo.
- Em cada executor (conciliation / sales) ainda é possível adicionar **delays internos** ou lógica específica de retry/backoff se o iFood passar a impor limites mais agressivos.
- Logs centralizados em `logs` (ver seção abaixo) permitem observar picos de erro (ex.: muitos 429) e ajustar esses parâmetros.

---

## 5. Logging & Observabilidade

### 5.1. Tabela `logs`

A tabela `logs` é o hub de logging central para todo o fluxo.

Padrão adotado para conciliação:

- Eventos principais gravados pelo **Node** (`dex-api`):
  - `ifood_conciliation.start` – quando um run é criado em `ifood_conciliation_runs`.
  - `ifood_conciliation.success` – quando a orquestração HTTP/Storage/received_files termina bem.
  - `ifood_conciliation.error` – para falhas macro (auth, upload, register_received_file, trigger do Python, etc.).

- Eventos principais gravados pelo **Python** (`dex-python`):
  - `ifood_conciliation.python.start` – início do processamento do arquivo de conciliação.
  - `ifood_conciliation.python.success` – fim bem-sucedido do `process_conciliation_file`.
  - `ifood_conciliation.python.error` – erro crítico no orquestrador.

Todos esses eventos incluem no `context` JSON campos como:

- `feature: 'ifood_conciliation'`.
- `system: 'dex-api' | 'dex-python'`.
- `stage`, `status`.
- `run_id`, `trace_id`, `file_id`, `account_id`, `merchant_id`, `competence`, `storage_path`, etc.

Consultas típicas:

```sql
select created_at, level, message, account_id, file_id, context
from logs
where context->>'feature' = 'ifood_conciliation'
order by created_at desc
limit 50;
```

ou só erros/críticos:

```sql
select *
from logs
where context->>'feature' = 'ifood_conciliation'
  and upper(level) in ('ERROR','CRITICAL')
order by created_at desc
limit 50;
```

### 5.2. Integração futura com Discord / alertas

Com essa padronização, é simples criar uma Edge Function (ou outro processo) que:

1. Consulta `logs` a cada X minutos em busca de novos eventos com:
   - `feature = 'ifood_conciliation'` ou `job_type = 'sales_sync'` (no futuro, incluindo `job_id` no contexto),
   - `level in ('ERROR','CRITICAL')`.
2. Monta uma mensagem amigável com `account_id`, `merchant_id`, `competence`, `stage`, `error_message`, `run_id`, `trace_id`.
3. Envia para um Webhook do Discord.

---

## 6. Como adicionar novos tipos de job (ex.: sales)

Quando formos incluir o job de **sales**:

1. **Modelagem**:
   - Garantir que `ifood_schedules.run_sales_sync = true` esteja setado para as contas desejadas.
   - Decidir qual campo usar para idempotência (por ex. dia de referência ou período de vendas).
   - Se necessário, adicionar na tabela `ifood_jobs` um campo dedicado (ex.: `job_day date`) para facilitar unicidade.

2. **Scheduler diário**:
   - No script `schedule-ifood-jobs`, além de conciliação, criar também jobs com `job_type = 'sales_sync'`.

3. **Worker**:
   - No roteador de jobs do `dex-worker`, adicionar um `case` para `job_type = 'sales_sync'` que chame o serviço de sync de vendas (`src/modules/ifood-sales/api` / `services/ifood-sales-sync.service.ts`).

4. **Logging**:
   - Seguir padrão semelhante ao da conciliação, com eventos do tipo:
     - `ifood_sales_sync.start` / `ifood_sales_sync.success` / `ifood_sales_sync.error`.
   - Incluir `job_id` no `context` para amarrar logs à linha em `ifood_jobs`.

Assim, a arquitetura de jobs permanece única e extensível, e cada novo tipo de job só precisa implementar seu executor específico e os pontos de log correspondentes.
