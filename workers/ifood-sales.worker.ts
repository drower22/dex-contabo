import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ifoodRateLimiter } from './utils/rate-limiter';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();

console.log('[ifood-sales-worker] ENV DEBUG', {
  cwd: process.cwd(),
  dirname: __dirname,
  hasSupabaseUrl: !!SUPABASE_URL,
  hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrlPreview: SUPABASE_URL ? SUPABASE_URL.slice(0, 30) : null,
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ifood-sales-worker] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados. Worker não conseguirá processar jobs.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const MAX_CONCURRENCY = Number.parseInt(process.env.IFOOD_WORKER_MAX_CONCURRENCY || '5', 10) || 5;
const POLL_INTERVAL_MS = Number.parseInt(process.env.IFOOD_WORKER_POLL_INTERVAL_MS || '10000', 10) || 10000;
const MAX_ATTEMPTS = Number.parseInt(process.env.IFOOD_WORKER_MAX_ATTEMPTS || '3', 10) || 3;

const WORKER_ID = `ifood-sales-${randomUUID()}`;

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

interface SalesSyncRange {
  startDate: string;
  endDate: string;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function getTargetEndDate(): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  local.setDate(local.getDate() - 1);
  return local.toISOString().split('T')[0];
}

async function computeSalesSyncRange(accountId: string, merchantId: string): Promise<SalesSyncRange | null> {
  if (!supabase) return null;

  const targetEnd = getTargetEndDate();

  const { data: lastCompleted, error } = await supabase
    .from('ifood_sales_sync_status')
    .select('period_end')
    .eq('account_id', accountId)
    .eq('merchant_id', merchantId)
    .eq('status', 'completed')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[ifood-sales-worker] Erro ao buscar último sync de vendas:', error.message);
  }

  const lastEnd = (lastCompleted as any)?.period_end as string | null;

  let startDate = targetEnd;

  if (lastEnd) {
    const nextDay = addDaysToDateString(lastEnd, 1);
    if (nextDay > targetEnd) {
      return null;
    }
    startDate = nextDay;
  }

  return { startDate, endDate: targetEnd };
}

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .eq('job_type', 'sales_sync')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true })
    .limit(limit * 2);

  if (error) {
    console.error('[ifood-sales-worker] Erro ao buscar jobs pendentes:', error.message);
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
      console.error('[ifood-sales-worker] Erro ao reservar job:', err?.message || err);
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
    console.error('[ifood-sales-worker] Erro ao marcar job como success:', error.message);
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
    console.error('[ifood-sales-worker] Erro ao marcar job como retry/failed:', error.message);
  }
}

async function processSalesSyncJob(job: IfoodJob) {
  if (!job.account_id || !job.merchant_id) {
    await markJobRetry(job, 'Dados incompletos no job (account_id/merchant_id ausentes).');
    return;
  }

  const range = await computeSalesSyncRange(job.account_id, job.merchant_id);

  if (!range) {
    console.log('[ifood-sales-worker] Nenhum período pendente para sync de vendas', {
      jobId: job.id,
      accountId: job.account_id,
      merchantId: job.merchant_id,
    });
    await markJobSuccess(job);
    return;
  }

  const nowIso = new Date().toISOString();

  if (!supabase) {
    await markJobRetry(job, 'Supabase não inicializado para sync de vendas.');
    return;
  }

  const { error: upsertError } = await supabase
    .from('ifood_sales_sync_status')
    .upsert(
      {
        account_id: job.account_id,
        merchant_id: job.merchant_id,
        period_start: range.startDate,
        period_end: range.endDate,
        status: 'in_progress',
        started_at: nowIso,
        completed_at: null,
        last_error: null,
      },
      {
        onConflict: 'account_id,merchant_id,period_start,period_end',
      },
    );

  if (upsertError) {
    console.error('[ifood-sales-worker] Erro ao upsert ifood_sales_sync_status:', upsertError.message);
    await markJobRetry(job, `Erro ao registrar status de sync de vendas: ${upsertError.message}`);
    return;
  }

  const body = {
    accountId: job.account_id,
    merchantId: job.merchant_id,
    periodStart: range.startDate,
    periodEnd: range.endDate,
  };

  const url = `${DEX_API_BASE_URL}/api/ifood/sales/sync`;

  try {
    console.log('[ifood-sales-worker] Disparando sync de vendas para job', {
      jobId: job.id,
      accountId: job.account_id,
      merchantId: job.merchant_id,
      periodStart: range.startDate,
      periodEnd: range.endDate,
      url,
    });

    const response = await ifoodRateLimiter.execute(() =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    );

    const responseText = await response.text();
    let parsed: any = {};
    if (responseText) {
      try {
        parsed = JSON.parse(responseText);
      } catch (parseErr: any) {
        console.error('[ifood-sales-worker] Erro ao fazer parse da resposta do sync de vendas:', parseErr?.message || parseErr);
      }
    }

    if (response.ok && parsed?.success) {
      const salesSynced = Number(parsed?.data?.salesSynced || 0);
      const totalPages = Number(parsed?.data?.totalPages || 0);

      const { error: updateError } = await supabase
        .from('ifood_sales_sync_status')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_sales: salesSynced,
          total_pages: totalPages,
          last_error: null,
        })
        .eq('account_id', job.account_id)
        .eq('merchant_id', job.merchant_id)
        .eq('period_start', range.startDate)
        .eq('period_end', range.endDate);

      if (updateError) {
        console.error('[ifood-sales-worker] Erro ao atualizar ifood_sales_sync_status após sucesso:', updateError.message);
      }

      await markJobSuccess(job);
      return;
    }

    const errorMessage = `HTTP ${response.status}: ${responseText.slice(0, 500)}`;

    const { error: statusError } = await supabase
      .from('ifood_sales_sync_status')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        last_error: errorMessage.slice(0, 500),
      })
      .eq('account_id', job.account_id)
      .eq('merchant_id', job.merchant_id)
      .eq('period_start', range.startDate)
      .eq('period_end', range.endDate);

    if (statusError) {
      console.error('[ifood-sales-worker] Erro ao atualizar ifood_sales_sync_status após falha:', statusError.message);
    }

    if (response.status >= 400 && response.status < 500) {
      console.error('[ifood-sales-worker] Erro não-retryable no sync de vendas:', {
        jobId: job.id,
        status: response.status,
        body: responseText.slice(0, 500),
      });
      job.attempts = (job.attempts || 0) + 1;
      job.next_retry_at = null;
      await markJobRetry(job, errorMessage);
      return;
    }

    console.warn('[ifood-sales-worker] Erro retryable no sync de vendas:', {
      jobId: job.id,
      status: response.status,
    });
    await markJobRetry(job, errorMessage);
  } catch (err: any) {
    const message = err?.message || String(err);

    const { error: statusError } = await supabase
      .from('ifood_sales_sync_status')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
      })
      .eq('account_id', job.account_id)
      .eq('merchant_id', job.merchant_id)
      .eq('period_start', range.startDate)
      .eq('period_end', range.endDate);

    if (statusError) {
      console.error('[ifood-sales-worker] Erro ao atualizar ifood_sales_sync_status após exceção:', statusError.message);
    }

    console.error('[ifood-sales-worker] Exceção ao processar job de vendas:', {
      jobId: job.id,
      error: message,
    });
    await markJobRetry(job, message);
  }
}

async function tick() {
  if (!supabase) {
    console.error('[ifood-sales-worker] Supabase não inicializado. Aguardando configuração...');
    await sleep(30_000);
    return;
  }

  const jobs = await reserveJobs(MAX_CONCURRENCY);

  if (!jobs.length) {
    return;
  }

  console.log('[ifood-sales-worker] Processando lote de jobs', {
    count: jobs.length,
    workerId: WORKER_ID,
  });

  await Promise.all(jobs.map((job) => processSalesSyncJob(job)));
}

async function main() {
  console.log('[ifood-sales-worker] Iniciado', {
    workerId: WORKER_ID,
    maxConcurrency: MAX_CONCURRENCY,
    pollIntervalMs: POLL_INTERVAL_MS,
    apiBase: DEX_API_BASE_URL,
  });

  while (true) {
    try {
      await tick();
    } catch (err: any) {
      console.error('[ifood-sales-worker] Erro inesperado no loop principal:', err?.message || err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[ifood-sales-worker] Falha ao iniciar worker:', err?.message || err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[ifood-sales-worker] Recebido SIGTERM, encerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[ifood-sales-worker] Recebido SIGINT, encerrando...');
  process.exit(0);
});
