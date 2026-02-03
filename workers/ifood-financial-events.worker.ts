import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { logError, logEvent } from '../services/app-logger';

// Garantir carregamento do .env mesmo quando o PM2 não injeta env_file
dotenv.config({ path: path.join(process.cwd(), '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.IFOOD_WORKER_MAX_CONCURRENCY || 10), 50));
const POLL_INTERVAL_MS = Math.max(2000, Math.min(Number(process.env.IFOOD_WORKER_POLL_INTERVAL_MS || 10000), 60000));
const MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.IFOOD_WORKER_MAX_ATTEMPTS || 3), 10));

const WORKER_ID = `ifood-financial-events-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type IfoodJob = {
  id: string;
  job_type: string;
  account_id: string | null;
  merchant_id: string | null;
  competence?: string | null;
  job_day: string | null;
  status: string;
  scheduled_for: string | null;
  attempts: number | null;
  next_retry_at: string | null;
  last_error: string | null;
  run_id?: string | null;
  trace_id?: string | null;
};

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

if (!supabase) {
  // eslint-disable-next-line no-console
  console.error('[ifood-financial-events-worker] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.');
}

function jobLogContext(job?: Partial<IfoodJob> | null) {
  return {
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-financial-events-worker',
    trace_id: (job?.trace_id || null) as any,
    run_id: (job?.run_id || null) as any,
    job_id: (job?.id || null) as any,
    account_id: (job?.account_id || null) as any,
    merchant_id: (job?.merchant_id || null) as any,
    job_type: 'financial_events_sync',
    competence: (job?.competence || null) as any,
  };
}

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .eq('job_type', 'financial_events_sync')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true })
    .limit(limit * 2);

  if (error) {
    await logError({
      ...jobLogContext(null),
      event: 'ifood.jobs.reserve.error',
      message: 'Erro ao buscar jobs pendentes',
      err: error,
    });
    return [];
  }

  const reserved: IfoodJob[] = [];
  const lockIso = new Date().toISOString();

  for (const job of candidates || []) {
    if (reserved.length >= limit) break;

    const { data: updated, error: updErr } = await supabase
      .from('ifood_jobs')
      .update({
        status: 'running',
        locked_at: lockIso,
        locked_by: WORKER_ID,
        updated_at: lockIso,
      })
      .eq('id', (job as any).id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (!updErr && updated) {
      reserved.push(updated as any);
    }
  }

  return reserved;
}

async function markJobSuccess(job: IfoodJob) {
  if (!supabase) return;

  const attempts = (job.attempts || 0) + 1;
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('ifood_jobs')
    .update({
      status: 'success',
      attempts,
      next_retry_at: null,
      last_error: null,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq('id', job.id);

  if (error) {
    await logError({
      ...jobLogContext(job),
      event: 'ifood.jobs.mark_success.error',
      message: 'Erro ao marcar job como success',
      err: error,
    });
  }
}

async function markJobRetry(job: IfoodJob, errorMessage: string) {
  if (!supabase) return;

  const previousAttempts = job.attempts || 0;
  const attempts = previousAttempts + 1;
  const now = Date.now();

  const backoffMinutes = Math.min(60, 5 * Math.pow(2, previousAttempts));
  const nextRetry = new Date(now + backoffMinutes * 60_000).toISOString();

  let status = 'pending';
  let next_retry_at: string | null = nextRetry;

  if (attempts >= MAX_ATTEMPTS) {
    status = 'failed';
    next_retry_at = null;
  }

  const { error } = await supabase
    .from('ifood_jobs')
    .update({
      status,
      attempts,
      next_retry_at,
      last_error: String(errorMessage || '').slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) {
    await logError({
      ...jobLogContext(job),
      event: 'ifood.jobs.mark_retry.error',
      message: 'Erro ao marcar job como retry/failed',
      err: error,
      data: { desired_status: status, next_retry_at },
    });
  }
}

async function getMerchantIdFromAuth(accountId: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('auth')
      .select('ifood_merchant_id')
      .eq('account_id', accountId)
      .not('ifood_merchant_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      await logError({
        ...jobLogContext({ account_id: accountId }),
        event: 'ifood.auth.fetch_merchant_id.error',
        message: 'Erro ao buscar merchant_id na auth',
        err: error,
      });
      return null;
    }

    return (data as any)?.ifood_merchant_id || null;
  } catch (err: any) {
    await logError({
      ...jobLogContext({ account_id: accountId }),
      event: 'ifood.auth.fetch_merchant_id.exception',
      message: 'Exceção ao buscar merchant_id na auth',
      err,
    });
    return null;
  }
}

async function processJob(job: IfoodJob) {
  let merchantId = job.merchant_id;

  if (!merchantId) {
    await logEvent({
      level: 'info',
      ...jobLogContext(job),
      event: 'ifood.job.merchant_id.missing',
      message: 'Job sem merchant_id, buscando na auth',
    });
    merchantId = await getMerchantIdFromAuth(job.account_id);
    if (!merchantId) {
      await markJobRetry(job, 'merchant_id ausente e não encontrado na tabela auth para esta account.');
      await logEvent({
        level: 'warn',
        ...jobLogContext(job),
        event: 'ifood.job.merchant_id.not_found',
        message: 'merchant_id ausente e não encontrado na auth',
      });
      return;
    }
  }

  // Incremental: últimos 3 dias com overlap
  const endDate = new Date();
  const beginDate = new Date();
  beginDate.setDate(endDate.getDate() - 3);

  const url = `${DEX_API_BASE_URL}/api/ifood/financial/events/sync`;
  const body = {
    accountId: job.account_id,
    merchantId,
    beginDate: beginDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    syncMode: 'incremental',
  };

  try {
    await logEvent({
      level: 'info',
      ...jobLogContext({ ...job, merchant_id: merchantId }),
      event: 'ifood.financial_events.sync.request',
      message: 'Disparando financial events sync',
      data: { url, beginDate: body.beginDate, endDate: body.endDate, syncMode: body.syncMode },
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();

    if (resp.ok) {
      await markJobSuccess(job);
      await logEvent({
        level: 'info',
        ...jobLogContext({ ...job, merchant_id: merchantId }),
        event: 'ifood.financial_events.sync.success',
        message: 'Financial events sync concluído',
        data: { http_status: resp.status },
      });
      return;
    }

    const msg = `HTTP ${resp.status}: ${text.slice(0, 500)}`;

    if (resp.status >= 400 && resp.status < 500) {
      await markJobRetry(job, msg);
      await logEvent({
        level: 'warn',
        ...jobLogContext({ ...job, merchant_id: merchantId }),
        event: 'ifood.financial_events.sync.http_error',
        message: 'Financial events sync retornou erro HTTP (4xx)',
        data: { http_status: resp.status, response_preview: text.slice(0, 200) },
      });
      return;
    }

    await markJobRetry(job, msg);
    await logEvent({
      level: 'error',
      ...jobLogContext({ ...job, merchant_id: merchantId }),
      event: 'ifood.financial_events.sync.http_error',
      message: 'Financial events sync retornou erro HTTP (5xx)',
      data: { http_status: resp.status, response_preview: text.slice(0, 200) },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    await markJobRetry(job, msg);
    await logError({
      ...jobLogContext({ ...job, merchant_id: merchantId }),
      event: 'ifood.financial_events.sync.exception',
      message: 'Exceção ao executar financial events sync',
      err,
    });
  }
}

async function tick() {
  const jobs = await reserveJobs(MAX_CONCURRENCY);
  if (!jobs.length) return;

  await Promise.all(jobs.map((j) => processJob(j)));
}

async function main() {
  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-financial-events-worker',
    event: 'worker.start',
    message: 'Worker iniciado',
    trace_id: WORKER_ID,
    data: {
      maxConcurrency: MAX_CONCURRENCY,
      pollIntervalMs: POLL_INTERVAL_MS,
      apiBase: DEX_API_BASE_URL,
    },
  });

  // Loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[ifood-financial-events-worker] fatal', e);
  process.exit(1);
});
