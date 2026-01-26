import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

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

    const level = asString(req.query?.level).trim();
    const search = asString(req.query?.search).trim();
    const accountId = asString(req.query?.account_id).trim();
    const marketplace = asString(req.query?.marketplace).trim();
    const service = asString(req.query?.service).trim();
    const event = asString(req.query?.event).trim();
    const source = asString(req.query?.source).trim();
    const jobId = asString(req.query?.job_id).trim();
    const runId = asString(req.query?.run_id).trim();
    const traceId = asString(req.query?.trace_id).trim();
    const from = asString(req.query?.from).trim();
    const to = asString(req.query?.to).trim();

    const supabase = createServiceSupabaseClient();

    let q = supabase
      .from('app_logs')
      .select(
        'id, created_at, level, event, message, marketplace, source, service, environment, agency_id, account_id, user_id, trace_id, run_id, job_id, request_id, merchant_id, competence, job_type, http_method, http_path, http_status, duration_ms, data',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });

    if (level) q = q.eq('level', level);
    if (accountId) q = q.eq('account_id', accountId);
    if (search) q = q.ilike('message', `%${search}%`);
    if (marketplace) q = q.eq('marketplace', marketplace);
    if (service) q = q.eq('service', service);
    if (event) q = q.eq('event', event);
    if (source) q = q.eq('source', source);
    if (jobId) q = q.eq('job_id', jobId);
    if (runId) q = q.eq('run_id', runId);
    if (traceId) q = q.eq('trace_id', traceId);

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
