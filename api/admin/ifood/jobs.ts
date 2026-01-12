import { createServiceSupabaseClient, requireAdminUser } from '../_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asInt(v: any, fallback: number): number {
  const n = Number.parseInt(asString(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(Math.max(asInt(req.query?.limit, 50), 1), 200);
    const offset = Math.max(asInt(req.query?.offset, 0), 0);

    const status = asString(req.query?.status).trim();
    const jobType = asString(req.query?.job_type).trim();
    const accountId = asString(req.query?.account_id).trim();
    const merchantId = asString(req.query?.merchant_id).trim();
    const from = asString(req.query?.from).trim();
    const to = asString(req.query?.to).trim();

    const supabase = createServiceSupabaseClient();

    let q = supabase
      .from('ifood_jobs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) q = q.eq('status', status);
    if (jobType) q = q.eq('job_type', jobType);
    if (accountId) q = q.eq('account_id', accountId);
    if (merchantId) q = q.eq('merchant_id', merchantId);

    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);

    const { data, error, count } = await q.range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: 'query_failed', message: error.message });
      return;
    }

    res.status(200).json({
      data: data ?? [],
      count: count ?? null,
      limit,
      offset,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
