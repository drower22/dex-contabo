import { createClient } from '@supabase/supabase-js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AppLog = {
  level: LogLevel;
  event: string;
  message: string;

  marketplace?: string;
  source: string;
  service: string;
  environment?: string;

  agency_id?: string | null;
  account_id?: string | null;
  user_id?: string | null;

  trace_id?: string | null;
  run_id?: string | null;
  job_id?: string | null;
  request_id?: string | null;

  merchant_id?: string | null;
  competence?: string | null;
  job_type?: string | null;

  http_method?: string | null;
  http_path?: string | null;
  http_status?: number | null;
  duration_ms?: number | null;

  data?: Record<string, any>;
};

let supabaseSingleton: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (supabaseSingleton) return supabaseSingleton;

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !key) return null;

  supabaseSingleton = createClient(url, key, {
    auth: { persistSession: false },
  });

  return supabaseSingleton;
}

function sanitize(obj: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return { unserializable: true };
  }
}

function safeError(err: any) {
  if (!err) return null;
  return {
    name: err?.name,
    message: err?.message || String(err),
    stack: err?.stack,
  };
}

export async function logEvent(input: AppLog) {
  const now = new Date();
  const payload = {
    level: input.level,
    event: input.event,
    message: input.message,

    marketplace: (input.marketplace || 'ifood').trim(),
    source: input.source,
    service: input.service,
    environment: input.environment || process.env.NODE_ENV || null,

    agency_id: input.agency_id || null,
    account_id: input.account_id || null,
    user_id: input.user_id || null,

    trace_id: input.trace_id || null,
    run_id: input.run_id || null,
    job_id: input.job_id || null,
    request_id: input.request_id || null,

    merchant_id: input.merchant_id || null,
    competence: input.competence || null,
    job_type: input.job_type || null,

    http_method: input.http_method || null,
    http_path: input.http_path || null,
    http_status: input.http_status ?? null,
    duration_ms: input.duration_ms ?? null,

    data: input.data ? sanitize(input.data) : {},
    created_at: now.toISOString(),
  };

  const supabase = getSupabaseClient() as any;
  if (!supabase) {
    // Fallback: manter log útil em stdout
    // eslint-disable-next-line no-console
    console.log('[app-logger:fallback]', payload);
    return;
  }

  const { error } = await supabase.from('app_logs').insert([payload as any]);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[app-logger] failed_to_insert', {
      message: error.message,
      payloadPreview: {
        level: payload.level,
        event: payload.event,
        service: payload.service,
        trace_id: payload.trace_id,
      },
    });
    // eslint-disable-next-line no-console
    console.log('[app-logger:fallback]', payload);
  }
}

export async function logError(params: Omit<AppLog, 'level'> & { err?: any }) {
  return logEvent({
    ...params,
    level: 'error',
    data: {
      ...(params.data || {}),
      error: safeError(params.err),
    },
  });
}
