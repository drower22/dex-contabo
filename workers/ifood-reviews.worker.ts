import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.IFOOD_WORKER_MAX_CONCURRENCY || 10), 50));
const POLL_INTERVAL_MS = Math.max(2000, Math.min(Number(process.env.IFOOD_WORKER_POLL_INTERVAL_MS || 10000), 60000));
const MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.IFOOD_WORKER_MAX_ATTEMPTS || 3), 10));

const WORKER_ID = `ifood-reviews-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type IfoodJob = {
  id: string;
  job_type: string;
  account_id: string | null;
  merchant_id: string | null;
  job_day: string | null;
  status: string;
  scheduled_for: string | null;
  attempts: number | null;
  next_retry_at: string | null;
  last_error: string | null;
};

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

if (!supabase) {
  console.error('[ifood-reviews-worker] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.');
}

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .eq('job_type', 'reviews_sync')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true })
    .limit(limit * 2);

  if (error) {
    console.error('[ifood-reviews-worker] Erro ao buscar jobs pendentes:', error.message);
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
    console.error('[ifood-reviews-worker] Erro ao marcar job como success:', error.message);
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
    console.error('[ifood-reviews-worker] Erro ao marcar job como retry/failed:', error.message);
  }
}

async function processJob(job: IfoodJob) {
  if (!job.account_id || !job.merchant_id) {
    await markJobRetry(job, 'Dados incompletos no job (account_id/merchant_id ausentes).');
    return;
  }

  const url = `${DEX_API_BASE_URL}/api/ifood/reviews/sync`;
  const body = {
    accountId: job.account_id,
    merchantId: job.merchant_id,
    mode: 'incremental',
    days: 30,
  };

  try {
    console.log('[ifood-reviews-worker] Disparando reviews sync', {
      jobId: job.id,
      accountId: job.account_id,
      merchantId: job.merchant_id,
      url,
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
      return;
    }

    const msg = `HTTP ${resp.status}: ${text.slice(0, 500)}`;

    if (resp.status >= 400 && resp.status < 500) {
      await markJobRetry(job, msg);
      return;
    }

    await markJobRetry(job, msg);
  } catch (err: any) {
    const msg = err?.message || String(err);
    await markJobRetry(job, msg);
  }
}

async function tick() {
  const jobs = await reserveJobs(MAX_CONCURRENCY);
  if (!jobs.length) return;

  await Promise.all(jobs.map((j) => processJob(j)));
}

async function main() {
  console.log('[ifood-reviews-worker] Iniciado', {
    workerId: WORKER_ID,
    maxConcurrency: MAX_CONCURRENCY,
    pollIntervalMs: POLL_INTERVAL_MS,
    apiBase: DEX_API_BASE_URL,
  });

  // Loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error('[ifood-reviews-worker] fatal', e);
  process.exit(1);
});
