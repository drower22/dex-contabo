import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asBoolean(v: any): boolean | null {
  const s = asString(v).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return null;
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

    const agencyId = asString(req.query?.agency_id ?? req.query?.agencyId).trim();
    const isActive = asBoolean(req.query?.is_active ?? req.query?.isActive);

    const supabase = createServiceSupabaseClient();

    let q = supabase
      .from('clients')
      .select('id, client_name, agency_id, is_active, created_at')
      .order('client_name', { ascending: true });

    if (agencyId) q = q.eq('agency_id', agencyId);
    if (isActive !== null) q = q.eq('is_active', isActive);

    const { data, error } = await q;

    if (error) {
      res.status(500).json({ error: 'query_failed', message: error.message });
      return;
    }

    res.status(200).json({ data: data ?? [] });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
