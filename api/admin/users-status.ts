import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asBoolean(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = asString(v).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return null;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'PATCH') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = asString(
      req.params?.userId ??
        req.query?.userId ??
        req.query?.id ??
        req.query?.user_id
    ).trim();
    const isActive = asBoolean(req.body?.is_active ?? req.body?.isActive);

    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    if (isActive === null) {
      res.status(400).json({ error: 'missing_is_active' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: user, error: userErr } = await supabase.from('agency_users').select('id, role').eq('id', userId).single();

    if (userErr) {
      res.status(500).json({ error: 'query_failed', message: userErr.message });
      return;
    }

    if (!user || String((user as any).role) !== 'client_user') {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    const { data: updated, error: updErr } = await supabase
      .from('agency_users')
      .update({ is_active: isActive })
      .eq('id', userId)
      .select('id, is_active')
      .single();

    if (updErr) {
      res.status(500).json({ error: 'update_failed', message: updErr.message });
      return;
    }

    res.status(200).json({ data: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
