import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'PUT') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = asString(req.params?.userId ?? req.query?.userId ?? req.query?.id ?? req.query?.user_id).trim();
    const role = asString(req.body?.role).trim();

    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    if (!role) {
      res.status(400).json({ error: 'missing_role' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: user, error: userErr } = await supabase
      .from('agency_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (userErr) {
      res.status(500).json({ error: 'query_failed', message: userErr.message });
      return;
    }

    if (!user?.id) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    const { data: updated, error: updErr } = await supabase
      .from('agency_users')
      .update({ role })
      .eq('id', userId)
      .select('id, role')
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
