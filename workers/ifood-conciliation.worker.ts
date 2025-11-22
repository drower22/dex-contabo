import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Carregar .env do projeto
// Quando compilado, __dirname será dist/workers, então subimos dois níveis até a raiz
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.error('[ifood-conciliation-worker] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados. Worker não conseguirá processar jobs.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const MAX_CONCURRENCY = Number.parseInt(process.env.IFOOD_WORKER_MAX_CONCURRENCY || '5', 10) || 5;
const POLL_INTERVAL_MS = Number.parseInt(process.env.IFOOD_WORKER_POLL_INTERVAL_MS || '10000', 10) || 10000;
const MAX_ATTEMPTS = Number.parseInt(process.env.IFOOD_WORKER_MAX_ATTEMPTS || '3', 10) || 3;

const WORKER_ID = `ifood-conciliation-${randomUUID()}`;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface IfoodJob {
  id: string;
  job_type: string;
  account_id: string | null;
  merchant_id: string | null;
  competence: string | null;
  status: string;
  attempts: number | null;
  next_retry_at: string | null;
}

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .eq('job_type', 'conciliation')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true })
    .limit(limit * 2);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[ifood-conciliation-worker] Erro ao buscar jobs pendentes:', error.message);
    return [];
  }

  const reserved: IfoodJob[] = [];
  const now = new Date().toISOString();

  for (const job of candidates || []) {
    if (reserved.length >= limit) break;
    try {
      const { data: updated, error: updateError } = await supabase
        .from('ifood_jobs')
        .update({
          status: 'running',
          locked_at: now,
          locked_by: WORKER_ID,
          updated_at: now,
        })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

      if (!updateError && updated) {
        reserved.push(updated as IfoodJob);
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[ifood-conciliation-worker] Erro ao reservar job:', err?.message || err);
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
    // eslint-disable-next-line no-console
    console.error('[ifood-conciliation-worker] Erro ao marcar job como success:', error.message);
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
      last_error: errorMessage.slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[ifood-conciliation-worker] Erro ao marcar job como retry/failed:', error.message);
  }
}

async function processConciliationJob(job: IfoodJob) {
  if (!job.merchant_id || !job.competence || !job.account_id) {
    await markJobRetry(job, 'Dados incompletos no job (merchant_id/competence/account_id ausentes).');
    return;
  }

  const body = {
    merchantId: job.merchant_id,
    competence: job.competence,
    storeId: job.account_id,
    triggerSource: 'scheduler',
  };

  const url = `${DEX_API_BASE_URL}/api/ingest/ifood-reconciliation`;

  try {
    // eslint-disable-next-line no-console
    console.log('[ifood-conciliation-worker] Disparando ingest para job', {
      jobId: job.id,
      accountId: job.account_id,
      merchantId: job.merchant_id,
      competence: job.competence,
      url,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    if (response.ok) {
      // eslint-disable-next-line no-console
      console.log('[ifood-conciliation-worker] Job concluído com sucesso', {
        jobId: job.id,
        status: response.status,
      });
      await markJobSuccess(job);
      return;
    }

    const errorMessage = `HTTP ${response.status}: ${responseText.slice(0, 500)}`;

    // 4xx geralmente não vale retry (auth, parâmetros, etc.)
    if (response.status >= 400 && response.status < 500) {
      // eslint-disable-next-line no-console
      console.error('[ifood-conciliation-worker] Erro não-retryable no ingest:', {
        jobId: job.id,
        status: response.status,
        body: responseText.slice(0, 500),
      });
      job.attempts = (job.attempts || 0) + 1;
      job.next_retry_at = null;
      await markJobRetry(job, errorMessage);
      return;
    }

    // 5xx / rede → retry com backoff
    // eslint-disable-next-line no-console
    console.warn('[ifood-conciliation-worker] Erro retryable no ingest:', {
      jobId: job.id,
      status: response.status,
    });
    await markJobRetry(job, errorMessage);
  } catch (err: any) {
    const message = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.error('[ifood-conciliation-worker] Exceção ao processar job:', {
      jobId: job.id,
      error: message,
    });
    await markJobRetry(job, message);
  }
}

async function tick() {
  if (!supabase) {
    // eslint-disable-next-line no-console
    console.error('[ifood-conciliation-worker] Supabase não inicializado. Aguardando configuração...');
    await sleep(30_000);
    return;
  }

  const jobs = await reserveJobs(MAX_CONCURRENCY);

  if (!jobs.length) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[ifood-conciliation-worker] Processando lote de jobs', {
    count: jobs.length,
    workerId: WORKER_ID,
  });

  await Promise.all(jobs.map((job) => processConciliationJob(job)));
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('[ifood-conciliation-worker] Iniciado', {
    workerId: WORKER_ID,
    maxConcurrency: MAX_CONCURRENCY,
    pollIntervalMs: POLL_INTERVAL_MS,
    apiBase: DEX_API_BASE_URL,
  });

  // Loop principal
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[ifood-conciliation-worker] Erro inesperado no loop principal:', err?.message || err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ifood-conciliation-worker] Falha ao iniciar worker:', err?.message || err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  // eslint-disable-next-line no-console
  console.log('[ifood-conciliation-worker] Recebido SIGTERM, encerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('[ifood-conciliation-worker] Recebido SIGINT, encerrando...');
  process.exit(0);
});
