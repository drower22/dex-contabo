import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ifoodRateLimiter } from './utils/rate-limiter';
import { logError, logEvent } from '../services/app-logger';

// Carregar .env do projeto (quando compilado, __dirname será dist/workers)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();

void logEvent({
  level: 'debug',
  marketplace: 'ifood',
  source: 'dex-contabo/worker',
  service: 'ifood-settlements-worker',
  event: 'worker.env',
  message: 'Env check',
  trace_id: 'boot',
  data: {
    cwd: process.cwd(),
    dirname: __dirname,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrlPreview: SUPABASE_URL ? SUPABASE_URL.slice(0, 30) : null,
  },
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  void logError({
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-settlements-worker',
    event: 'worker.env.missing',
    message: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados. Worker não conseguirá processar jobs.',
  });
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const MAX_CONCURRENCY = Number.parseInt(process.env.IFOOD_WORKER_MAX_CONCURRENCY || '5', 10) || 5;
const POLL_INTERVAL_MS = Number.parseInt(process.env.IFOOD_WORKER_POLL_INTERVAL_MS || '10000', 10) || 10000;
const MAX_ATTEMPTS = Number.parseInt(process.env.IFOOD_WORKER_MAX_ATTEMPTS || '3', 10) || 3;

const WORKER_ID = `ifood-settlements-${randomUUID()}`;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface IfoodJob {
  id: string;
  job_type: string;
  account_id: string | null;
  merchant_id: string | null;
  competence: string | null;
  job_day?: string | null;
  status: string;
  attempts: number | null;
  next_retry_at: string | null;
  run_id?: string | null;
  trace_id?: string | null;
}

function jobLogContext(job?: Partial<IfoodJob> | null) {
  return {
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-settlements-worker',
    trace_id: (job?.trace_id || null) as any,
    run_id: (job?.run_id || null) as any,
    job_id: (job?.id || null) as any,
    account_id: (job?.account_id || null) as any,
    merchant_id: (job?.merchant_id || null) as any,
    job_type: 'settlements_weekly',
    competence: (job?.competence || null) as any,
  };
}

function computePreviousWeekRangeFromJobDay(jobDay: string): { beginPaymentDate: string; endPaymentDate: string } {
  // jobDay em formato YYYY-MM-DD
  const base = new Date(`${jobDay}T00:00:00Z`);

  if (Number.isNaN(base.getTime())) {
    throw new Error(`job_day inválido: ${jobDay}`);
  }

  const dayOfWeek = base.getUTCDay(); // 0=domingo,1=segunda,...

  // Segunda da semana "deste" jobDay
  const mondayOffsetThisWeek = dayOfWeek === 0 ? -6 : -(dayOfWeek - 1);
  const mondayThisWeek = new Date(base);
  mondayThisWeek.setUTCDate(base.getUTCDate() + mondayOffsetThisWeek);

  // Segunda da semana ANTERIOR
  const mondayPrev = new Date(mondayThisWeek);
  mondayPrev.setUTCDate(mondayThisWeek.getUTCDate() - 7);

  // Domingo da semana ANTERIOR
  const sundayPrev = new Date(mondayPrev);
  sundayPrev.setUTCDate(mondayPrev.getUTCDate() + 6);

  const beginPaymentDate = mondayPrev.toISOString().split('T')[0];
  const endPaymentDate = sundayPrev.toISOString().split('T')[0];

  return { beginPaymentDate, endPaymentDate };
}

function computeLastDaysRange(days: number): { beginPaymentDate: string; endPaymentDate: string } {
  const endDate = new Date();
  const beginDate = new Date(endDate);
  beginDate.setDate(endDate.getDate() - days + 1);
  const beginPaymentDate = beginDate.toISOString().split('T')[0];
  const endPaymentDate = endDate.toISOString().split('T')[0];
  return { beginPaymentDate, endPaymentDate };
}

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .in('job_type', ['settlements_weekly', 'settlements_daily'])
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
      await logError({
        ...jobLogContext(job as any),
        event: 'ifood.jobs.reserve.exception',
        message: 'Exceção ao reservar job',
        err,
      });
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
      last_error: errorMessage.slice(0, 500),
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

async function processSettlementsWeeklyJob(job: IfoodJob) {
  if (!job.account_id || !job.merchant_id) {
    await markJobRetry(job, 'Dados incompletos no job (account_id/merchant_id ausentes).');
    await logEvent({
      level: 'warn',
      ...jobLogContext(job),
      event: 'ifood.job.invalid',
      message: 'Dados incompletos no job (account_id/merchant_id ausentes)',
    });
    return;
  }

  const jobDay = job.job_day || new Date().toISOString().split('T')[0];

  let range;
  try {
    range = computePreviousWeekRangeFromJobDay(jobDay);
  } catch (err: any) {
    await markJobRetry(job, `Erro ao calcular semana anterior: ${err?.message || String(err)}`);
    await logError({
      ...jobLogContext(job),
      event: 'ifood.settlements.week_range.error',
      message: 'Erro ao calcular semana anterior',
      err,
      data: { job_day: jobDay },
    });
    return;
  }

  const url = `${DEX_API_BASE_URL}/api/ifood/settlements`;
  const body = {
    storeId: job.account_id,
    merchantId: job.merchant_id,
    ingest: true,
    triggerSource: 'settlements_weekly_job',
    beginPaymentDate: range.beginPaymentDate,
    endPaymentDate: range.endPaymentDate,
  };

  try {
    await logEvent({
      level: 'info',
      ...jobLogContext(job),
      event: 'ifood.settlements.ingest.request',
      message: 'Disparando ingest de settlements semanais',
      data: { url, beginPaymentDate: range.beginPaymentDate, endPaymentDate: range.endPaymentDate },
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

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
        await logError({
          ...jobLogContext(job),
          event: 'ifood.settlements.ingest.response_parse.error',
          message: 'Falha ao parsear resposta JSON do endpoint de settlements',
          err,
        });
      }
    }

    if (response.ok && parsed && parsed.success) {
      await markJobSuccess(job);
      await logEvent({
        level: 'info',
        ...jobLogContext(job),
        event: 'ifood.settlements.ingest.success',
        message: 'Job de settlements concluído com sucesso',
        data: {
          processedItems: parsed?.processedItems ?? null,
          dbSavedItems: parsed?.dbSavedItems ?? null,
          http_status: response.status,
        },
      });
      return;
    }

    const errorMessage = `HTTP ${response.status}: ${text.slice(0, 500)}`;

    if (response.status >= 400 && response.status < 500) {
      await logEvent({
        level: 'warn',
        ...jobLogContext(job),
        event: 'ifood.settlements.ingest.http_error',
        message: 'Erro não-retryable no ingest de settlements (4xx)',
        data: { http_status: response.status, response_preview: text.slice(0, 200) },
      });
      job.attempts = (job.attempts || 0) + 1;
      job.next_retry_at = null;
      await markJobRetry(job, errorMessage);
      return;
    }

    await logEvent({
      level: 'warn',
      ...jobLogContext(job),
      event: 'ifood.settlements.ingest.http_error',
      message: 'Erro retryable no ingest de settlements (5xx)',
      data: { http_status: response.status },
    });
    await markJobRetry(job, errorMessage);
  } catch (err: any) {
    const message = err?.message || String(err);
    await logError({
      ...jobLogContext(job),
      event: 'ifood.settlements.ingest.exception',
      message: 'Exceção ao processar job de settlements',
      err,
    });
    await markJobRetry(job, message);
  }
}

async function processSettlementsDailyJob(job: IfoodJob) {
  if (!job.account_id || !job.merchant_id) {
    await markJobRetry(job, 'Dados incompletos no job (account_id/merchant_id ausentes).');
    await logEvent({
      level: 'warn',
      ...jobLogContext(job),
      event: 'ifood.job.invalid',
      message: 'Dados incompletos no job (account_id/merchant_id ausentes)',
    });
    return;
  }

  const range = computeLastDaysRange(7); // últimos 7 dias incremental

  const url = `${DEX_API_BASE_URL}/api/ifood/settlements`;
  const body = {
    storeId: job.account_id,
    merchantId: job.merchant_id,
    ingest: true,
    triggerSource: 'settlements_daily_job',
    beginPaymentDate: range.beginPaymentDate,
    endPaymentDate: range.endPaymentDate,
  };

  try {
    await logEvent({
      level: 'info',
      ...jobLogContext(job),
      event: 'ifood.settlements.daily.request',
      message: 'Disparando ingest de settlements diários (últimos 7 dias)',
      data: { url, beginPaymentDate: range.beginPaymentDate, endPaymentDate: range.endPaymentDate },
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

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
        await logError({
          ...jobLogContext(job),
          event: 'ifood.settlements.daily.response_parse.error',
          message: 'Falha ao parsear resposta JSON do endpoint de settlements',
          err,
        });
      }
    }

    if (response.ok && parsed && parsed.success) {
      await markJobSuccess(job);
      await logEvent({
        level: 'info',
        ...jobLogContext(job),
        event: 'ifood.settlements.daily.success',
        message: 'Job de settlements diários concluído com sucesso',
        data: {
          processedItems: parsed?.processedItems ?? null,
          dbSavedItems: parsed?.dbSavedItems ?? null,
          http_status: response.status,
        },
      });
      return;
    }

    const errorMessage = `HTTP ${response.status}: ${text.slice(0, 500)}`;

    if (response.status >= 400 && response.status < 500) {
      await logEvent({
        level: 'warn',
        ...jobLogContext(job),
        event: 'ifood.settlements.daily.http_error',
        message: 'Erro não-retryable no ingest de settlements (4xx)',
        data: { http_status: response.status, response_preview: text.slice(0, 200) },
      });
      job.attempts = (job.attempts || 0) + 1;
      job.next_retry_at = null;
      await markJobRetry(job, errorMessage);
      return;
    }

    await logEvent({
      level: 'warn',
      ...jobLogContext(job),
      event: 'ifood.settlements.daily.http_error',
      message: 'Erro retryable no ingest de settlements (5xx)',
      data: { http_status: response.status },
    });
    await markJobRetry(job, errorMessage);
  } catch (err: any) {
    const message = err?.message || String(err);
    await logError({
      ...jobLogContext(job),
      event: 'ifood.settlements.daily.exception',
      message: 'Exceção ao processar job de settlements diários',
      err,
    });
    await markJobRetry(job, message);
  }
}

async function tick() {
  if (!supabase) {
    await logEvent({
      level: 'warn',
      marketplace: 'ifood',
      source: 'dex-contabo/worker',
      service: 'ifood-settlements-worker',
      event: 'worker.supabase.missing',
      message: 'Supabase não inicializado. Aguardando configuração...',
      trace_id: WORKER_ID,
    });
    await sleep(30_000);
    return;
  }

  const jobs = await reserveJobs(MAX_CONCURRENCY);

  if (!jobs.length) {
    return;
  }

  await Promise.all(jobs.map((job) => processJob(job)));
}

async function processJob(job: IfoodJob) {
  if (job.job_type === 'settlements_daily') {
    await processSettlementsDailyJob(job);
  } else if (job.job_type === 'settlements_weekly') {
    await processSettlementsWeeklyJob(job);
  } else {
    await markJobRetry(job, `job_type não suportado: ${job.job_type}`);
  }
}

async function main() {
  await logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-settlements-worker',
    event: 'worker.start',
    message: 'Worker iniciado',
    trace_id: WORKER_ID,
    data: { maxConcurrency: MAX_CONCURRENCY, pollIntervalMs: POLL_INTERVAL_MS, apiBase: DEX_API_BASE_URL },
  });

  // Loop principal
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err: any) {
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/worker',
        service: 'ifood-settlements-worker',
        event: 'worker.loop.error',
        message: 'Erro inesperado no loop principal',
        trace_id: WORKER_ID,
        err,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ifood-settlements-worker] Falha ao iniciar worker:', err?.message || err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  void logEvent({
    level: 'info',
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-settlements-worker',
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
    service: 'ifood-settlements-worker',
    event: 'worker.signal',
    message: 'Recebido SIGINT, encerrando...',
    trace_id: WORKER_ID,
    data: { signal: 'SIGINT' },
  });
  process.exit(0);
});
