import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Carregar .env do projeto (quando compilado, __dirname será dist/workers)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DEX_API_BASE_URL = (process.env.DEX_API_BASE_URL || 'http://localhost:3000').trim();

console.log('[ifood-settlements-worker] ENV DEBUG', {
  cwd: process.cwd(),
  dirname: __dirname,
  hasSupabaseUrl: !!SUPABASE_URL,
  hasServiceRole: !!SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrlPreview: SUPABASE_URL ? SUPABASE_URL.slice(0, 30) : null,
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ifood-settlements-worker] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados. Worker não conseguirá processar jobs.');
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

async function reserveJobs(limit: number): Promise<IfoodJob[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('ifood_jobs')
    .select('*')
    .eq('job_type', 'settlements_weekly')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order('scheduled_for', { ascending: true })
    .limit(limit * 2);

  if (error) {
    console.error('[ifood-settlements-worker] Erro ao buscar jobs pendentes:', error.message);
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
      console.error('[ifood-settlements-worker] Erro ao reservar job:', err?.message || err);
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
    console.error('[ifood-settlements-worker] Erro ao marcar job como success:', error.message);
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
    console.error('[ifood-settlements-worker] Erro ao marcar job como retry/failed:', error.message);
  }
}

async function processSettlementsWeeklyJob(job: IfoodJob) {
  if (!job.account_id || !job.merchant_id) {
    await markJobRetry(job, 'Dados incompletos no job (account_id/merchant_id ausentes).');
    return;
  }

  const jobDay = job.job_day || new Date().toISOString().split('T')[0];

  let range;
  try {
    range = computePreviousWeekRangeFromJobDay(jobDay);
  } catch (err: any) {
    await markJobRetry(job, `Erro ao calcular semana anterior: ${err?.message || String(err)}`);
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
    console.log('[ifood-settlements-worker] Disparando ingest de settlements semanais', {
      jobId: job.id,
      accountId: job.account_id,
      merchantId: job.merchant_id,
      beginPaymentDate: range.beginPaymentDate,
      endPaymentDate: range.endPaymentDate,
      url,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
        console.warn('[ifood-settlements-worker] Falha ao parsear resposta JSON do endpoint de settlements:', err?.message || err);
      }
    }

    if (response.ok && parsed && parsed.success) {
      console.log('[ifood-settlements-worker] Job de settlements concluído com sucesso', {
        jobId: job.id,
        processedItems: parsed.processedItems,
        dbSavedItems: parsed.dbSavedItems,
      });
      await markJobSuccess(job);
      return;
    }

    const errorMessage = `HTTP ${response.status}: ${text.slice(0, 500)}`;

    if (response.status >= 400 && response.status < 500) {
      console.error('[ifood-settlements-worker] Erro não-retryable no ingest de settlements:', {
        jobId: job.id,
        status: response.status,
        body: text.slice(0, 500),
      });
      job.attempts = (job.attempts || 0) + 1;
      job.next_retry_at = null;
      await markJobRetry(job, errorMessage);
      return;
    }

    console.warn('[ifood-settlements-worker] Erro retryable no ingest de settlements:', {
      jobId: job.id,
      status: response.status,
    });
    await markJobRetry(job, errorMessage);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[ifood-settlements-worker] Exceção ao processar job de settlements:', {
      jobId: job.id,
      error: message,
    });
    await markJobRetry(job, message);
  }
}

async function tick() {
  if (!supabase) {
    console.error('[ifood-settlements-worker] Supabase não inicializado. Aguardando configuração...');
    await sleep(30_000);
    return;
  }

  const jobs = await reserveJobs(MAX_CONCURRENCY);

  if (!jobs.length) {
    return;
  }

  console.log('[ifood-settlements-worker] Processando lote de jobs', {
    count: jobs.length,
    workerId: WORKER_ID,
  });

  await Promise.all(jobs.map((job) => processSettlementsWeeklyJob(job)));
}

async function main() {
  console.log('[ifood-settlements-worker] Iniciado', {
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
      console.error('[ifood-settlements-worker] Erro inesperado no loop principal:', err?.message || err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[ifood-settlements-worker] Falha ao iniciar worker:', err?.message || err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[ifood-settlements-worker] Recebido SIGTERM, encerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[ifood-settlements-worker] Recebido SIGINT, encerrando...');
  process.exit(0);
});
