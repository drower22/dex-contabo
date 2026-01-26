import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { logError, logEvent } from '../services/app-logger';

/**
 * Worker Scheduler para criar jobs automáticos na fila ifood_jobs
 * 
 * RESPONSABILIDADES:
 * 1. Criar jobs de settlements_weekly toda segunda-feira (distribuído ao longo de 4h)
 * 2. Criar jobs de anticipations_daily todo dia (distribuído ao longo de 2h)
 * 
 * LÓGICA ESCALÁVEL (para 1000+ contas):
 * - Roda em loop a cada 1 minuto
 * - Cria jobs GRADUALMENTE para evitar sobrecarga
 * - Distribui jobs ao longo de uma janela de tempo
 * - Respeita rate limits da API do iFood
 * 
 * EXEMPLO:
 * - 1000 contas em 4h = 250 contas/hora = ~4 contas/minuto
 * - Evita criar todos os jobs de uma vez
 */

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

void logEvent({
  level: 'debug',
  marketplace: 'ifood',
  source: 'dex-contabo/worker',
  service: 'ifood-scheduler-worker',
  event: 'worker.env',
  message: 'Env check',
  trace_id: 'boot',
  data: {
    cwd: process.cwd(),
    dirname: __dirname,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
  },
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  void logError({
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'worker.env.missing',
    message: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.',
  });
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const WORKER_ID = `ifood-scheduler-${randomUUID()}`;
const CHECK_INTERVAL_MS = 60_000; // 1 minuto

// Configurações de distribuição temporal (para escalar para 1000+ contas)
const SETTLEMENTS_WINDOW_HOURS = 4; // Distribuir settlements ao longo de 4 horas
const ANTICIPATIONS_WINDOW_HOURS = 2; // Distribuir anticipations ao longo de 2 horas
const BATCH_SIZE = 5; // Criar 5 jobs por minuto (ajustável)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Account {
  id: string;
  ifood_merchant_id: string | null;
}

/**
 * Busca todas as contas ativas com iFood configurado
 */
async function getActiveAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, ifood_merchant_id')
    .eq('active', true)
    .not('ifood_merchant_id', 'is', null);

  if (error) {
    await logError({
      marketplace: 'ifood',
      source: 'dex-contabo/worker',
      service: 'ifood-scheduler-worker',
      event: 'ifood.scheduler.fetch_accounts.error',
      message: 'Erro ao buscar contas ativas',
      err: error,
    });
    return [];
  }

  return (data || []) as Account[];
}

/**
 * Verifica se já existe job para uma conta/tipo/dia específico
 */
async function jobExistsForToday(
  accountId: string,
  jobType: string,
  jobDay: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('ifood_jobs')
    .select('id')
    .eq('account_id', accountId)
    .eq('job_type', jobType)
    .eq('job_day', jobDay)
    .maybeSingle();

  if (error) {
    await logError({
      marketplace: 'ifood',
      source: 'dex-contabo/worker',
      service: 'ifood-scheduler-worker',
      event: 'ifood.scheduler.job_exists.error',
      message: 'Erro ao verificar job existente',
      err: error,
      data: { accountId, jobType, jobDay },
    });
    return false;
  }

  return !!data;
}

/**
 * Cria job de settlements_weekly (toda segunda-feira, distribuído ao longo de 4h)
 * 
 * LÓGICA ESCALÁVEL:
 * - Segunda-feira entre 8h e 12h (4 horas)
 * - Cria apenas BATCH_SIZE jobs por minuto
 * - Distribui carga ao longo do tempo
 */
async function scheduleSettlementsWeekly() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=domingo, 1=segunda, ...
  const hour = now.getHours();

  // Só roda às segundas-feiras entre 8h e 12h (janela de 4h)
  if (dayOfWeek !== 1 || hour < 8 || hour >= 12) {
    return;
  }

  const jobDay = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const accounts = await getActiveAccounts();

  // Contar quantos jobs já foram criados hoje
  const { count: existingCount } = await supabase
    .from('ifood_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('job_type', 'settlements_weekly')
    .eq('job_day', jobDay);

  const totalCreated = existingCount || 0;
  const totalAccounts = accounts.length;

  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'ifood.scheduler.settlements_weekly.batch_start',
    message: 'Agendando settlements_weekly (distribuído)',
    data: { jobDay, totalAccounts, totalCreated, remaining: totalAccounts - totalCreated, batchSize: BATCH_SIZE },
  });

  // Se já criou todos, retorna
  if (totalCreated >= totalAccounts) {
    return;
  }

  // Criar apenas BATCH_SIZE jobs neste ciclo
  let created = 0;
  for (const account of accounts) {
    if (created >= BATCH_SIZE) break;

    const exists = await jobExistsForToday(account.id, 'settlements_weekly', jobDay);
    if (exists) {
      continue;
    }

    // Calcular scheduled_for distribuído ao longo da janela
    const minutesIntoWindow = (hour - 8) * 60 + now.getMinutes();
    const scheduledFor = new Date(now.getTime() + minutesIntoWindow * 1000).toISOString();

    const { error } = await supabase.from('ifood_jobs').insert({
      job_type: 'settlements_weekly',
      account_id: account.id,
      merchant_id: account.ifood_merchant_id,
      job_day: jobDay,
      status: 'pending',
      scheduled_for: scheduledFor,
    });

    if (error) {
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/worker',
        service: 'ifood-scheduler-worker',
        event: 'ifood.scheduler.settlements_weekly.insert.error',
        message: 'Erro ao criar job settlements_weekly',
        err: error,
        data: { accountId: account.id, merchantId: account.ifood_merchant_id, jobDay },
      });
    } else {
      await logEvent({
        level: 'info',
        marketplace: 'ifood',
        source: 'dex-contabo/worker',
        service: 'ifood-scheduler-worker',
        event: 'ifood.scheduler.settlements_weekly.insert.success',
        message: 'Job settlements_weekly criado',
        data: { accountId: account.id, merchantId: account.ifood_merchant_id, jobDay, scheduledFor },
      });
      created++;
    }
  }

  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'ifood.scheduler.settlements_weekly.batch_finish',
    message: 'Batch de settlements criado',
    data: { created, totalCreated: totalCreated + created, totalAccounts },
  });
}

/**
 * Cria job de anticipations_daily (todo dia, distribuído ao longo de 2h)
 * 
 * LÓGICA ESCALÁVEL:
 * - Todo dia entre 6h e 8h (2 horas)
 * - Cria apenas BATCH_SIZE jobs por minuto
 * - Distribui carga ao longo do tempo
 */
async function scheduleAnticipationsDaily() {
  const now = new Date();
  const hour = now.getHours();

  // Só roda entre 6h e 8h (janela de 2h)
  if (hour < 6 || hour >= 8) {
    return;
  }

  const jobDay = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const accounts = await getActiveAccounts();

  // Contar quantos jobs já foram criados hoje
  const { count: existingCount } = await supabase
    .from('ifood_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('job_type', 'anticipations_daily')
    .eq('job_day', jobDay);

  const totalCreated = existingCount || 0;
  const totalAccounts = accounts.length;

  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'ifood.scheduler.anticipations_daily.batch_start',
    message: 'Agendando anticipations_daily (distribuído)',
    data: { jobDay, totalAccounts, totalCreated, remaining: totalAccounts - totalCreated, batchSize: BATCH_SIZE },
  });

  // Se já criou todos, retorna
  if (totalCreated >= totalAccounts) {
    return;
  }

  // Criar apenas BATCH_SIZE jobs neste ciclo
  let created = 0;
  for (const account of accounts) {
    if (created >= BATCH_SIZE) break;

    const exists = await jobExistsForToday(account.id, 'anticipations_daily', jobDay);
    if (exists) {
      continue;
    }

    // Calcular scheduled_for distribuído ao longo da janela
    const minutesIntoWindow = (hour - 6) * 60 + now.getMinutes();
    const scheduledFor = new Date(now.getTime() + minutesIntoWindow * 1000).toISOString();

    const { error } = await supabase.from('ifood_jobs').insert({
      job_type: 'anticipations_daily',
      account_id: account.id,
      merchant_id: account.ifood_merchant_id,
      job_day: jobDay,
      status: 'pending',
      scheduled_for: scheduledFor,
    });

    if (error) {
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/worker',
        service: 'ifood-scheduler-worker',
        event: 'ifood.scheduler.anticipations_daily.insert.error',
        message: 'Erro ao criar job anticipations_daily',
        err: error,
        data: { accountId: account.id, merchantId: account.ifood_merchant_id, jobDay },
      });
    } else {
      await logEvent({
        level: 'info',
        marketplace: 'ifood',
        source: 'dex-contabo/worker',
        service: 'ifood-scheduler-worker',
        event: 'ifood.scheduler.anticipations_daily.insert.success',
        message: 'Job anticipations_daily criado',
        data: { accountId: account.id, merchantId: account.ifood_merchant_id, jobDay, scheduledFor },
      });
      created++;
    }
  }

  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'ifood.scheduler.anticipations_daily.batch_finish',
    message: 'Batch de anticipations criado',
    data: { created, totalCreated: totalCreated + created, totalAccounts },
  });
}

async function tick() {
  try {
    await scheduleSettlementsWeekly();
    await scheduleAnticipationsDaily();
  } catch (err: any) {
    await logError({
      marketplace: 'ifood',
      source: 'dex-contabo/worker',
      service: 'ifood-scheduler-worker',
      event: 'worker.tick.error',
      message: 'Erro no tick',
      trace_id: WORKER_ID,
      err,
    });
  }
}

async function main() {
  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'worker.start',
    message: 'Worker iniciado',
    trace_id: WORKER_ID,
    data: { checkIntervalMs: CHECK_INTERVAL_MS },
  });

  // Loop principal
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((err) => {
  void logError({
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'worker.fatal',
    message: 'Falha ao iniciar scheduler',
    trace_id: WORKER_ID,
    err,
  });
  // eslint-disable-next-line no-console
  console.error('[ifood-scheduler] Falha ao iniciar scheduler:', err?.message || err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  void logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'worker.signal',
    message: 'Recebido SIGTERM, encerrando...',
    trace_id: WORKER_ID,
    data: { signal: 'SIGTERM' },
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  void logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-scheduler-worker',
    event: 'worker.signal',
    message: 'Recebido SIGINT, encerrando...',
    trace_id: WORKER_ID,
    data: { signal: 'SIGINT' },
  });
  process.exit(0);
});
