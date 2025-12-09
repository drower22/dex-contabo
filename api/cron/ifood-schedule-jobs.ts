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
      .select('account_id, merchant_id, enabled, run_conciliation, run_sales_sync')
      .eq('enabled', true);

    if (schedulesError) {
      // eslint-disable-next-line no-console
      console.error('[ifood-schedule-jobs] Falha ao buscar ifood_schedules:', schedulesError.message);
      res.status(500).json({ error: 'Failed to fetch schedules', details: schedulesError.message });
      return;
    }

    const baseSchedules = (schedules || []).filter((row: any) => row.account_id && row.merchant_id);
    const conciliationSchedules = baseSchedules.filter((row: any) => row.run_conciliation);
    const salesSyncSchedules = baseSchedules.filter((row: any) => row.run_sales_sync);

    if (dryRun) {
      res.status(200).json({
        message: 'Dry run - no jobs inserted',
        competence,
        total_schedules: baseSchedules.length,
        conciliation_schedules: conciliationSchedules.length,
        sales_sync_schedules: salesSyncSchedules.length,
      });
      return;
    }

    if (conciliationSchedules.length === 0 && salesSyncSchedules.length === 0) {
      res.status(200).json({
        message: 'No enabled schedules for conciliation or sales_sync',
        competence,
        total_schedules: baseSchedules.length,
        conciliation_schedules: 0,
        sales_sync_schedules: 0,
        inserted_conciliation: 0,
        inserted_sales_sync: 0,
      });
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const jobDay = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const dayOfWeek = now.getUTCDay(); // 0=domingo, 1=segunda, ... (usar UTC para evitar timezone do servidor)

    let conciliationInserted = 0;
    let salesSyncInserted = 0;
    let reconciliationStatusInserted = 0;
    let settlementsWeeklyInserted = 0;

    if (conciliationSchedules.length > 0) {
      const conciliationJobsPayload = conciliationSchedules.map((row: any) => ({
        job_type: 'conciliation',
        account_id: row.account_id,
        merchant_id: row.merchant_id,
        competence,
        scheduled_for: nowIso,
        job_day: jobDay,
        status: 'pending',
      }));

      const { error: insertError } = await supabase
        .from('ifood_jobs')
        .upsert(conciliationJobsPayload, {
          onConflict: 'job_type,account_id,competence,job_day',
          ignoreDuplicates: true,
        });

      if (insertError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de conciliação em ifood_jobs:', insertError.message);
        res.status(500).json({ error: 'Failed to upsert conciliation jobs', details: insertError.message });
        return;
      }

      conciliationInserted = conciliationJobsPayload.length;
    }

    if (salesSyncSchedules.length > 0) {
      const salesJobsPayload = salesSyncSchedules.map((row: any) => ({
        job_type: 'sales_sync',
        account_id: row.account_id,
        merchant_id: row.merchant_id,
        competence: null,
        scheduled_for: nowIso,
        status: 'pending',
      }));

      const { error: insertSalesError } = await supabase
        .from('ifood_jobs')
        .insert(salesJobsPayload);

      if (insertSalesError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de sales_sync em ifood_jobs:', insertSalesError.message);
        res.status(500).json({ error: 'Failed to insert sales_sync jobs', details: insertSalesError.message });
        return;
      }

      salesSyncInserted = salesJobsPayload.length;
    }

    // Criar jobs semanais de settlements (repasses) toda segunda-feira
    // Consideramos segunda-feira em UTC para simplificar (ajuste fino pode ser feito via horário do cron)
    if (dayOfWeek === 1) {
      const settlementsWeeklySchedules = conciliationSchedules; // usar mesmas lojas da conciliação por padrão

      if (settlementsWeeklySchedules.length > 0) {
        const settlementsWeeklyJobsPayload = settlementsWeeklySchedules.map((row: any) => ({
          job_type: 'settlements_weekly',
          account_id: row.account_id,
          merchant_id: row.merchant_id,
          competence: null,
          scheduled_for: nowIso,
          job_day: jobDay,
          status: 'pending',
        }));

        const { error: insertSettlementsWeeklyError } = await supabase
          .from('ifood_jobs')
          .upsert(settlementsWeeklyJobsPayload, {
            onConflict: 'job_type,account_id,job_day',
            ignoreDuplicates: true,
          });

        if (insertSettlementsWeeklyError) {
          // eslint-disable-next-line no-console
          console.error('[ifood-schedule-jobs] Falha ao criar jobs de settlements_weekly em ifood_jobs:', insertSettlementsWeeklyError.message);
          res.status(500).json({ error: 'Failed to upsert settlements_weekly jobs', details: insertSettlementsWeeklyError.message });
          return;
        }

        settlementsWeeklyInserted = settlementsWeeklyJobsPayload.length;
      }
    }

    // Criar jobs de reconciliation_status para todas as lojas ativas
    if (baseSchedules.length > 0) {
      const reconciliationStatusJobsPayload = baseSchedules.map((row: any) => ({
        job_type: 'reconciliation_status',
        account_id: row.account_id,
        merchant_id: row.merchant_id,
        competence: null, // Jobs de status não são por competência
        scheduled_for: nowIso,
        job_day: jobDay,
        status: 'pending',
      }));

      const { error: insertReconciliationStatusError } = await supabase
        .from('ifood_jobs')
        .upsert(reconciliationStatusJobsPayload, {
          onConflict: 'job_type,account_id,job_day',
          ignoreDuplicates: true,
        });

      if (insertReconciliationStatusError) {
        // eslint-disable-next-line no-console
        console.error('[ifood-schedule-jobs] Falha ao criar jobs de reconciliation_status em ifood_jobs:', insertReconciliationStatusError.message);
        res.status(500).json({ error: 'Failed to upsert reconciliation_status jobs', details: insertReconciliationStatusError.message });
        return;
      }

      reconciliationStatusInserted = reconciliationStatusJobsPayload.length;
    }

    res.status(200).json({
      message: 'iFood jobs scheduled',
      competence,
      total_schedules: baseSchedules.length,
      conciliation_schedules: conciliationSchedules.length,
      sales_sync_schedules: salesSyncSchedules.length,
      inserted_conciliation: conciliationInserted,
      inserted_sales_sync: salesSyncInserted,
      inserted_reconciliation_status: reconciliationStatusInserted,
      inserted_settlements_weekly: settlementsWeeklyInserted,
      is_monday_utc: dayOfWeek === 1,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[ifood-schedule-jobs] Unexpected error:', err?.message || err);
    res.status(500).json({ error: 'Unexpected error', message: err?.message || String(err) });
  }
}
