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

function normalizeTime(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function asLocalDateParts(nowUtc: Date, tzOffsetMinutes: number): { y: number; m: number; d: number; dow: number } {
  const localMs = nowUtc.getTime() - tzOffsetMinutes * 60_000;
  const local = new Date(localMs);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
  };
}

function buildUtcFromLocalDateTime(
  parts: { y: number; m: number; d: number },
  time: string,
  tzOffsetMinutes: number,
) {
  const [hh, mm, ss] = time.split(':').map((p) => Number.parseInt(p, 10));
  const localUtcMs = Date.UTC(parts.y, parts.m - 1, parts.d, hh || 0, mm || 0, ss || 0);
  return new Date(localUtcMs + tzOffsetMinutes * 60_000);
}

function computeScheduledFor(
  nowUtc: Date,
  windowStart: string,
  windowEnd: string,
  index: number,
  total: number,
  tzOffsetMinutes: number,
): string {
  const local = asLocalDateParts(nowUtc, tzOffsetMinutes);
  const startUtc = buildUtcFromLocalDateTime({ y: local.y, m: local.m, d: local.d }, windowStart, tzOffsetMinutes);
  const endUtc = buildUtcFromLocalDateTime({ y: local.y, m: local.m, d: local.d }, windowEnd, tzOffsetMinutes);

  const start = startUtc.getTime();
  const end = endUtc.getTime();
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const span = Math.max(1, max - min);
  const t = total > 1 ? index / (total - 1) : 0;
  const scheduled = new Date(min + Math.floor(span * t));
  const nowMs = nowUtc.getTime();
  return new Date(Math.max(nowMs, scheduled.getTime())).toISOString();
}

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
    // eslint-disable-next-line no-console
    console.log('[ifood-schedule-jobs] env', {
      hasCronSecret: Boolean(expectedSecret),
      cronSecretLen: expectedSecret ? expectedSecret.length : 0,
      hasSupabaseUrl: Boolean((process.env.SUPABASE_URL || '').trim()),
      hasServiceRoleKey: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
    });
    if (!expectedSecret) {
      res.status(500).json({ error: 'CRON_SECRET not configured' });
      return;
    }

    const token = getBearerToken(req.headers?.authorization ?? req.headers?.Authorization);
    // eslint-disable-next-line no-console
    console.log('[ifood-schedule-jobs] auth', {
      hasAuthHeader: Boolean(req.headers?.authorization ?? req.headers?.Authorization),
      tokenLen: token ? token.length : 0,
      tokenPreview: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
    });
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

    const { data: globalSchedule, error: globalErr } = await supabase
      .from('ifood_global_schedule')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (globalErr) {
      // eslint-disable-next-line no-console
      console.error('[ifood-schedule-jobs] Falha ao buscar ifood_global_schedule:', globalErr.message);
      res.status(500).json({ error: 'Failed to fetch global schedule', details: globalErr.message });
      return;
    }

    if (!globalSchedule || globalSchedule.enabled === false) {
      res.status(200).json({
        message: 'Global schedule disabled',
        competence,
      });
      return;
    }

    const windowStart = normalizeTime(String(globalSchedule.window_start || '03:00:00')) || '03:00:00';
    const windowEnd = normalizeTime(String(globalSchedule.window_end || '06:00:00')) || '06:00:00';

    const runConciliation = Boolean(globalSchedule.run_conciliation);
    const runSalesSync = Boolean(globalSchedule.run_sales_sync);
    const runSettlementsWeekly = Boolean(globalSchedule.run_settlements_weekly);
    const runAnticipationsDaily = Boolean(globalSchedule.run_anticipations_daily);
    const runReconciliationStatus = Boolean(globalSchedule.run_reconciliation_status);

    const tz = String(globalSchedule.timezone || 'America/Sao_Paulo');
    const tzOffsetMinutes = tz === 'America/Sao_Paulo' ? 180 : 180;

    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id, ifood_merchant_id, is_active')
      .eq('is_active', true)
      .not('ifood_merchant_id', 'is', null);

    if (accountsError) {
      // eslint-disable-next-line no-console
      console.error('[ifood-schedule-jobs] Falha ao buscar accounts:', accountsError.message);
      res.status(500).json({ error: 'Failed to fetch accounts', details: accountsError.message });
      return;
    }

    const baseAccounts = (accounts || []).filter((row: any) => row?.id && row?.ifood_merchant_id);

    if (dryRun) {
      res.status(200).json({
        message: 'Dry run - no jobs inserted',
        competence,
        total_accounts: baseAccounts.length,
        window_start: windowStart,
        window_end: windowEnd,
        timezone: tz,
        run_conciliation: runConciliation,
        run_sales_sync: runSalesSync,
        run_settlements_weekly: runSettlementsWeekly,
        run_anticipations_daily: runAnticipationsDaily,
        run_reconciliation_status: runReconciliationStatus,
      });
      return;
    }

    if (baseAccounts.length === 0) {
      res.status(200).json({
        message: 'No active accounts with ifood_merchant_id',
        competence,
        total_accounts: 0,
      });
      return;
    }

    const now = new Date();
    const jobDay = now.toISOString().slice(0, 10);
    const local = asLocalDateParts(now, tzOffsetMinutes);

    let conciliationInserted = 0;
    let salesSyncInserted = 0;
    let anticipationsDailyInserted = 0;
    let reconciliationStatusInserted = 0;
    let settlementsWeeklyInserted = 0;

    const total = baseAccounts.length;

    const conciliationPayload = runConciliation
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'conciliation',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    const salesSyncPayload = runSalesSync
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'sales_sync',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    const anticipationsPayload = runAnticipationsDaily
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'anticipations_daily',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    const statusPayload = runReconciliationStatus
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'reconciliation_status',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    const isMondayLocal = local.dow === 1;
    const settlementsPayload = runSettlementsWeekly && isMondayLocal
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'settlements_weekly',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    if (conciliationPayload.length > 0) {
      const { error: insertError } = await supabase
        .from('ifood_jobs')
        .upsert(conciliationPayload, {
          onConflict: 'job_type,account_id,competence,job_day',
          ignoreDuplicates: true,
        });

      if (insertError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de conciliação em ifood_jobs:', insertError.message);
        res.status(500).json({ error: 'Failed to upsert conciliation jobs', details: insertError.message });
        return;
      }

      conciliationInserted = conciliationPayload.length;
    }

    if (salesSyncPayload.length > 0) {
      const { error: insertSalesError } = await supabase
        .from('ifood_jobs')
        .upsert(salesSyncPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertSalesError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de sales_sync em ifood_jobs:', insertSalesError.message);
        res.status(500).json({ error: 'Failed to upsert sales_sync jobs', details: insertSalesError.message });
        return;
      }

      salesSyncInserted = salesSyncPayload.length;
    }

    if (anticipationsPayload.length > 0) {
      const { error: insertAnticipationsError } = await supabase
        .from('ifood_jobs')
        .upsert(anticipationsPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertAnticipationsError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de anticipations_daily em ifood_jobs:', insertAnticipationsError.message);
        res.status(500).json({ error: 'Failed to upsert anticipations_daily jobs', details: insertAnticipationsError.message });
        return;
      }

      anticipationsDailyInserted = anticipationsPayload.length;
    }

    if (settlementsPayload.length > 0) {
      const { error: insertSettlementsError } = await supabase
        .from('ifood_jobs')
        .upsert(settlementsPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertSettlementsError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de settlements_weekly em ifood_jobs:', insertSettlementsError.message);
        res.status(500).json({ error: 'Failed to upsert settlements_weekly jobs', details: insertSettlementsError.message });
        return;
      }

      settlementsWeeklyInserted = settlementsPayload.length;
    }

    if (statusPayload.length > 0) {
      const { error: insertStatusError } = await supabase
        .from('ifood_jobs')
        .upsert(statusPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertStatusError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de reconciliation_status em ifood_jobs:', insertStatusError.message);
        res.status(500).json({ error: 'Failed to upsert reconciliation_status jobs', details: insertStatusError.message });
        return;
      }

      reconciliationStatusInserted = statusPayload.length;
    }

    res.status(200).json({
      message: 'iFood jobs scheduled',
      competence,
      total_accounts: baseAccounts.length,
      window_start: windowStart,
      window_end: windowEnd,
      timezone: tz,
      inserted_conciliation: conciliationInserted,
      inserted_sales_sync: salesSyncInserted,
      inserted_anticipations_daily: anticipationsDailyInserted,
      inserted_reconciliation_status: reconciliationStatusInserted,
      inserted_settlements_weekly: settlementsWeeklyInserted,
      is_monday_local: isMondayLocal,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[ifood-schedule-jobs] Unexpected error:', err?.message || err);
    res.status(500).json({ error: 'Unexpected error', message: err?.message || String(err) });
  }
}
