import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.error('[ifood-schedule-jobs] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

function getBearerToken(headerValue: unknown): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function getCurrentCompetence(override?: string | null): string {
  if (override && /^\d{4}-\d{2}$/.test(override)) {
    return override;
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const expectedSecret = (process.env.CRON_SECRET || '').trim();
    if (!expectedSecret) {
      res.status(500).json({ error: 'CRON_SECRET not configured' });
      return;
    }

    const token = getBearerToken(req.headers?.authorization ?? req.headers?.Authorization);
    if (!token || token !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!supabase) {
      res.status(500).json({ error: 'Supabase client not initialized' });
      return;
    }

    const body = (req.body || {}) as { competence?: string; dryRun?: boolean };
    const competence = getCurrentCompetence(body.competence);
    const dryRun = Boolean(body.dryRun);

    const { data: schedules, error: schedulesError } = await supabase
      .from('ifood_schedules')
      .select('account_id, merchant_id, enabled, run_conciliation')
      .eq('enabled', true)
      .eq('run_conciliation', true);

    if (schedulesError) {
      // eslint-disable-next-line no-console
      console.error('[ifood-schedule-jobs] Falha ao buscar ifood_schedules:', schedulesError.message);
      res.status(500).json({ error: 'Failed to fetch schedules', details: schedulesError.message });
      return;
    }

    const effectiveSchedules = (schedules || []).filter((row: any) => row.account_id && row.merchant_id);

    if (dryRun) {
      res.status(200).json({
        message: 'Dry run - no jobs inserted',
        competence,
        total_schedules: effectiveSchedules.length,
      });
      return;
    }

    if (effectiveSchedules.length === 0) {
      res.status(200).json({
        message: 'No enabled schedules for conciliation',
        competence,
        total_schedules: 0,
        inserted: 0,
      });
      return;
    }

    const nowIso = new Date().toISOString();

    const jobsPayload = effectiveSchedules.map((row: any) => ({
      job_type: 'conciliation',
      account_id: row.account_id,
      merchant_id: row.merchant_id,
      competence,
      scheduled_for: nowIso,
      status: 'pending',
    }));

    const { error: insertError } = await supabase
      .from('ifood_jobs')
      .upsert(jobsPayload, {
        onConflict: 'job_type,account_id,competence',
        ignoreDuplicates: true,
      });

    if (insertError) {
      // eslint-disable-next-line no-console
      console.error('[ifood-schedule-jobs] Falha ao criar jobs em ifood_jobs:', insertError.message);
      res.status(500).json({ error: 'Failed to upsert jobs', details: insertError.message });
      return;
    }

    res.status(200).json({
      message: 'iFood conciliation jobs scheduled',
      competence,
      total_schedules: effectiveSchedules.length,
      attempted_inserts: jobsPayload.length,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[ifood-schedule-jobs] Unexpected error:', err?.message || err);
    res.status(500).json({ error: 'Unexpected error', message: err?.message || String(err) });
  }
}
