import { createServiceSupabaseClient, requireAdminUser } from '../_shared/admin-auth';

function getJobId(req: any): string {
  const fromParams = req?.params?.jobId ?? req?.params?.job_id;
  const fromQuery = req?.query?.jobId ?? req?.query?.job_id;
  const raw = fromParams ?? fromQuery;
  return typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? '').trim() : String(raw ?? '').trim();
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const jobId = getJobId(req);
    if (!jobId) {
      res.status(400).json({ error: 'missing_job_id' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: current, error: getErr } = await supabase
      .from('ifood_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (getErr) {
      res.status(500).json({ error: 'query_failed', message: getErr.message });
      return;
    }

    if (!current) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    const nowIso = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from('ifood_jobs')
      .update({
        status: 'pending',
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
        scheduled_for: nowIso,
        updated_at: nowIso,
      })
      .eq('id', jobId)
      .select('*')
      .single();

    if (updErr) {
      res.status(500).json({ error: 'update_failed', message: updErr.message });
      return;
    }

    await supabase.from('logs').insert({
      level: 'info',
      message: 'admin.ifood_jobs.retry',
      account_id: current.account_id,
      context: {
        feature: 'admin_panel',
        action: 'retry',
        entity: 'ifood_jobs',
        job_id: jobId,
        job_type: current.job_type,
        previous_status: current.status,
        requested_by: admin.email,
        requested_by_user_id: admin.userId,
        requested_at: nowIso,
      },
    });

    res.status(200).json({
      message: 'Job marcado como pending para retry',
      job: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
