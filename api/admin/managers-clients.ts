import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean);
    } catch {
      return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
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

    const managerId = asString(req.query?.managerId ?? req.query?.id ?? req.query?.manager_id).trim();
    const clientIds = asStringArray(req.body?.client_ids ?? req.body?.clientIds);

    if (!managerId) {
      res.status(400).json({ error: 'missing_manager_id' });
      return;
    }
    if (!clientIds.length) {
      res.status(400).json({ error: 'missing_client_ids' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: manager, error: managerErr } = await supabase
      .from('agency_users')
      .select('id, role')
      .eq('id', managerId)
      .single();

    if (managerErr) {
      res.status(500).json({ error: 'query_failed', message: managerErr.message });
      return;
    }

    if (!manager || String((manager as any).role) !== 'manager') {
      res.status(404).json({ error: 'manager_not_found' });
      return;
    }

    const { error: delErr } = await supabase
      .from('agency_user_clients')
      .delete()
      .eq('agency_user_id', managerId);

    if (delErr) {
      res.status(500).json({ error: 'unlink_failed', message: delErr.message });
      return;
    }

    const inserts = clientIds.map((clientId) => ({ agency_user_id: managerId, client_id: clientId }));
    const { error: upsertErr } = await supabase
      .from('agency_user_clients')
      .upsert(inserts, { onConflict: 'agency_user_id,client_id' });

    if (upsertErr) {
      res.status(500).json({ error: 'link_failed', message: upsertErr.message });
      return;
    }

    res.status(200).json({ data: { manager_id: managerId, client_ids: clientIds } });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
