import { createServiceSupabaseClient, requireAdminUser } from '../_shared/admin-auth';
import { logEvent } from '../../../services/app-logger';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asBooleanOrNull(v: any): boolean | null {
  if (v == null) return null;
  const s = asString(v).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return null;
}

function pickBoolean(body: any, key: string): boolean | null {
  return asBooleanOrNull(body?.[key]);
}

function pickTime(body: any, key: string): string | null {
  const raw = asString(body?.[key]).trim();
  if (!raw) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return null;
  return raw.length === 5 ? `${raw}:00` : raw;
}

export default async function handler(req: any, res: any) {
  try {
    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('ifood_global_schedule')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (error) {
        res.status(500).json({ error: 'query_failed', message: error.message });
        return;
      }

      res.status(200).json({ data: data ?? null });
      return;
    }

    if (req.method === 'PUT') {
      const body = (req.body || {}) as any;

      const enabled = pickBoolean(body, 'enabled');
      const windowStart = pickTime(body, 'window_start') ?? pickTime(body, 'windowStart');
      const windowEnd = pickTime(body, 'window_end') ?? pickTime(body, 'windowEnd');

      const runConciliation = pickBoolean(body, 'run_conciliation') ?? pickBoolean(body, 'runConciliation');
      const runSalesSync = pickBoolean(body, 'run_sales_sync') ?? pickBoolean(body, 'runSalesSync');
      const runSettlementsWeekly = pickBoolean(body, 'run_settlements_weekly') ?? pickBoolean(body, 'runSettlementsWeekly');
      const runAnticipationsDaily = pickBoolean(body, 'run_anticipations_daily') ?? pickBoolean(body, 'runAnticipationsDaily');
      const runReconciliationStatus = pickBoolean(body, 'run_reconciliation_status') ?? pickBoolean(body, 'runReconciliationStatus');
      const runReviewsSync = pickBoolean(body, 'run_reviews_sync') ?? pickBoolean(body, 'runReviewsSync');

      const patch: any = {
        updated_at: new Date().toISOString(),
      };

      if (enabled !== null) patch.enabled = enabled;
      if (windowStart) patch.window_start = windowStart;
      if (windowEnd) patch.window_end = windowEnd;

      if (runConciliation !== null) patch.run_conciliation = runConciliation;
      if (runSalesSync !== null) patch.run_sales_sync = runSalesSync;
      if (runSettlementsWeekly !== null) patch.run_settlements_weekly = runSettlementsWeekly;
      if (runAnticipationsDaily !== null) patch.run_anticipations_daily = runAnticipationsDaily;
      if (runReconciliationStatus !== null) patch.run_reconciliation_status = runReconciliationStatus;
      if (runReviewsSync !== null) patch.run_reviews_sync = runReviewsSync;

      const { data: updated, error: updErr } = await supabase
        .from('ifood_global_schedule')
        .update(patch)
        .eq('id', 1)
        .select('*')
        .maybeSingle();

      if (updErr) {
        res.status(500).json({ error: 'update_failed', message: updErr.message });
        return;
      }

      await logEvent({
        level: 'info',
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'admin-ifood-global-schedule',
        event: 'admin.ifood_global_schedule.update',
        message: 'Atualização do agendamento global iFood',
        user_id: admin.userId,
        data: {
          requested_by: admin.email,
          requested_at: new Date().toISOString(),
          patch,
        },
      });

      res.status(200).json({ data: updated ?? null });
      return;
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
