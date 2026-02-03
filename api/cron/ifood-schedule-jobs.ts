import { createClient } from '@supabase/supabase-js';
import { logError, logEvent } from '../../services/app-logger';

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

function floorToSlot(nowUtc: Date, slotMinutes: number): string {
  const slotMs = slotMinutes * 60_000;
  const floored = new Date(Math.floor(nowUtc.getTime() / slotMs) * slotMs);
  return floored.toISOString();
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

    const traceId = (req.headers?.['x-trace-id'] || req.headers?.['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`) as string;

    const expectedSecret = (process.env.CRON_SECRET || '').trim();

    await logEvent({
      level: 'debug',
      marketplace: 'ifood',
      source: 'dex-contabo/api',
      service: 'ifood-schedule-jobs',
      event: 'ifood.schedule.env',
      message: 'Env check',
      trace_id: traceId,
      data: {
        hasCronSecret: Boolean(expectedSecret),
        cronSecretLen: expectedSecret ? expectedSecret.length : 0,
        hasSupabaseUrl: Boolean((process.env.SUPABASE_URL || '').trim()),
        hasServiceRoleKey: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      },
    });
    if (!expectedSecret) {
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-schedule-jobs',
        event: 'ifood.schedule.error',
        message: 'CRON_SECRET not configured',
        trace_id: traceId,
      });
      res.status(500).json({ error: 'CRON_SECRET not configured' });
      return;
    }

    const token = getBearerToken(req.headers?.authorization ?? req.headers?.Authorization);

    await logEvent({
      level: 'debug',
      marketplace: 'ifood',
      source: 'dex-contabo/api',
      service: 'ifood-schedule-jobs',
      event: 'ifood.schedule.auth',
      message: 'Authorization check',
      trace_id: traceId,
      data: {
        hasAuthHeader: Boolean(req.headers?.authorization ?? req.headers?.Authorization),
        tokenLen: token ? token.length : 0,
        tokenPreview: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
      },
    });
    if (!token || token !== expectedSecret) {
      await logEvent({
        level: 'warn',
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-schedule-jobs',
        event: 'ifood.schedule.unauthorized',
        message: 'Unauthorized',
        trace_id: traceId,
      });
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
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-schedule-jobs',
        event: 'ifood.schedule.fetch_global_schedule.error',
        message: 'Failed to fetch global schedule',
        trace_id: traceId,
        err: globalErr,
      });
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
    const runSettlementsDaily = Boolean((globalSchedule as any).run_settlements_daily);
    const runAnticipationsDaily = Boolean(globalSchedule.run_anticipations_daily);
    const runAnticipationsWeekly = Boolean((globalSchedule as any).run_anticipations_weekly);
    const runReconciliationStatus = Boolean(globalSchedule.run_reconciliation_status);
    const runReviewsSync = Boolean((globalSchedule as any).run_reviews_sync);
    const runFinancialEventsSync = Boolean((globalSchedule as any).run_financial_events_sync);

    const tz = String(globalSchedule.timezone || 'America/Sao_Paulo');
    const tzOffsetMinutes = tz === 'America/Sao_Paulo' ? 180 : 180;

    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id, ifood_merchant_id, is_active')
      .eq('is_active', true);

    if (accountsError) {
      await logError({
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-schedule-jobs',
        event: 'ifood.schedule.fetch_accounts.error',
        message: 'Failed to fetch accounts',
        trace_id: traceId,
        err: accountsError,
      });
      res.status(500).json({ error: 'Failed to fetch accounts', details: accountsError.message });
      return;
    }

    const baseAccounts = (accounts || []).filter((row: any) => row?.id);

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
        run_reviews_sync: runReviewsSync,
        run_financial_events_sync: runFinancialEventsSync,
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

    const jobSlot = floorToSlot(now, 30);

    let conciliationInserted = 0;
    let salesSyncInserted = 0;
    let anticipationsDailyInserted = 0;
    let reconciliationStatusInserted = 0;
    let settlementsWeeklyInserted = 0;
    let settlementsDailyInserted = 0;
    let reviewsSyncInserted = 0;
    let financialEventsSyncInserted = 0;
    let anticipationsWeeklyInserted = 0;

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
          job_slot: jobSlot,
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

    const isMondayLocal = local.dow === 1;

    const settlementsDailyPayload = runSettlementsDaily
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'settlements_daily',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          status: 'pending',
        }))
      : [];

    const anticipationsWeeklyPayload = runAnticipationsWeekly && isMondayLocal
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'anticipations_weekly',
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

    const reviewsPayload = runReviewsSync
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'reviews_sync',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          job_slot: jobSlot,
          status: 'pending',
        }))
      : [];

    const financialEventsPayload = runFinancialEventsSync
      ? baseAccounts.map((row: any, idx: number) => ({
          job_type: 'financial_events_sync',
          account_id: row.id,
          merchant_id: row.ifood_merchant_id,
          competence: null,
          scheduled_for: computeScheduledFor(now, windowStart, windowEnd, idx, total, tzOffsetMinutes),
          job_day: jobDay,
          job_slot: jobSlot,
          status: 'pending',
        }))
      : [];

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
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.conciliation.error',
          message: 'Failed to upsert conciliation jobs',
          trace_id: traceId,
          err: insertError,
          data: { count: conciliationPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert conciliation jobs', details: insertError.message });
        return;
      }

      conciliationInserted = conciliationPayload.length;
    }

    if (salesSyncPayload.length > 0) {
      const { error: insertSalesError } = await supabase
        .from('ifood_jobs')
        .upsert(salesSyncPayload, {
          onConflict: 'job_type,account_id,job_slot',
          ignoreDuplicates: true,
        });

      if (insertSalesError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.sales_sync.error',
          message: 'Failed to upsert sales_sync jobs',
          trace_id: traceId,
          err: insertSalesError,
          data: { count: salesSyncPayload.length },
        });
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
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.anticipations_daily.error',
          message: 'Failed to upsert anticipations_daily jobs',
          trace_id: traceId,
          err: insertAnticipationsError,
          data: { count: anticipationsPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert anticipations_daily jobs', details: insertAnticipationsError.message });
        return;
      }

      anticipationsDailyInserted = anticipationsPayload.length;
    }

    if (settlementsDailyPayload.length > 0) {
      const { error: insertSettlementsDailyError } = await supabase
        .from('ifood_jobs')
        .upsert(settlementsDailyPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertSettlementsDailyError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.settlements_daily.error',
          message: 'Failed to upsert settlements_daily jobs',
          trace_id: traceId,
          err: insertSettlementsDailyError,
          data: { count: settlementsDailyPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert settlements_daily jobs', details: insertSettlementsDailyError.message });
        return;
      }

      settlementsDailyInserted = settlementsDailyPayload.length;
    }

    if (anticipationsWeeklyPayload.length > 0) {
      const { error: insertAnticipationsWeeklyError } = await supabase
        .from('ifood_jobs')
        .upsert(anticipationsWeeklyPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertAnticipationsWeeklyError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.anticipations_weekly.error',
          message: 'Failed to upsert anticipations_weekly jobs',
          trace_id: traceId,
          err: insertAnticipationsWeeklyError,
          data: { count: anticipationsWeeklyPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert anticipations_weekly jobs', details: insertAnticipationsWeeklyError.message });
        return;
      }

      anticipationsWeeklyInserted = anticipationsWeeklyPayload.length;
    }

    if (settlementsPayload.length > 0) {
      const { error: insertSettlementsError } = await supabase
        .from('ifood_jobs')
        .upsert(settlementsPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertSettlementsError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.settlements_weekly.error',
          message: 'Failed to upsert settlements_weekly jobs',
          trace_id: traceId,
          err: insertSettlementsError,
          data: { count: settlementsPayload.length },
        });
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
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.reconciliation_status.error',
          message: 'Failed to upsert reconciliation_status jobs',
          trace_id: traceId,
          err: insertStatusError,
          data: { count: statusPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert reconciliation_status jobs', details: insertStatusError.message });
        return;
      }

      reconciliationStatusInserted = statusPayload.length;
    }

    if (reviewsPayload.length > 0) {
      const { error: insertReviewsError } = await supabase
        .from('ifood_jobs')
        .upsert(reviewsPayload, {
          onConflict: 'job_type,account_id,job_slot',
          ignoreDuplicates: true,
        });

      if (insertReviewsError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.reviews_sync.error',
          message: 'Failed to upsert reviews_sync jobs',
          trace_id: traceId,
          err: insertReviewsError,
          data: { count: reviewsPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert reviews_sync jobs', details: insertReviewsError.message });
        return;
      }

      reviewsSyncInserted = reviewsPayload.length;
    }

    if (financialEventsPayload.length > 0) {
      const { error: insertFinancialEventsError } = await supabase
        .from('ifood_jobs')
        .upsert(financialEventsPayload, {
          onConflict: 'job_type,account_id,job_slot',
          ignoreDuplicates: true,
        });

      if (insertFinancialEventsError) {
        await logError({
          marketplace: 'ifood',
          source: 'dex-contabo/api',
          service: 'ifood-schedule-jobs',
          event: 'ifood.jobs.upsert.financial_events_sync.error',
          message: 'Failed to upsert financial_events_sync jobs',
          trace_id: traceId,
          err: insertFinancialEventsError,
          data: { count: financialEventsPayload.length },
        });
        res.status(500).json({ error: 'Failed to upsert financial_events_sync jobs', details: insertFinancialEventsError.message });
        return;
      }

      financialEventsSyncInserted = financialEventsPayload.length;
    }

    await logEvent({
      level: 'info',
      marketplace: 'ifood',
      source: 'dex-contabo/api',
      service: 'ifood-schedule-jobs',
      event: 'ifood.schedule.success',
      message: 'iFood jobs scheduled',
      trace_id: traceId,
      competence,
      data: {
        total_accounts: baseAccounts.length,
        inserted_conciliation: conciliationInserted,
        inserted_sales_sync: salesSyncInserted,
        inserted_anticipations_daily: anticipationsDailyInserted,
        inserted_reconciliation_status: reconciliationStatusInserted,
        inserted_settlements_weekly: settlementsWeeklyInserted,
        inserted_reviews_sync: reviewsSyncInserted,
        inserted_financial_events_sync: financialEventsSyncInserted,
        window_start: windowStart,
        window_end: windowEnd,
        timezone: tz,
        is_monday_local: isMondayLocal,
      },
    });

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
      inserted_reviews_sync: reviewsSyncInserted,
      inserted_financial_events_sync: financialEventsSyncInserted,
      is_monday_local: isMondayLocal,
    });
  } catch (err: any) {
    await logError({
      marketplace: 'ifood',
      source: 'dex-contabo/api',
      service: 'ifood-schedule-jobs',
      event: 'ifood.schedule.unexpected_error',
      message: 'Unexpected error',
      trace_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      err,
    });
    res.status(500).json({ error: 'Unexpected error', message: err?.message || String(err) });
  }
}
