import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
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

    const supabase = createServiceSupabaseClient();

    let q = supabase
      .from('agency_users')
      .select('id, email, agency_id, role, is_active, created_at')
      .eq('role', 'client_user')
      .order('created_at', { ascending: false });

    if (agencyId) q = q.eq('agency_id', agencyId);

    const { data: users, error: uErr } = await q;
    if (uErr) {
      res.status(500).json({ error: 'query_failed', message: uErr.message });
      return;
    }

    const userIds = (users ?? []).map((u: any) => u.id);

    let links: any[] = [];
    if (userIds.length > 0) {
      const { data: lData, error: lErr } = await supabase
        .from('agency_user_clients')
        .select('agency_user_id, client_id')
        .in('agency_user_id', userIds);
      if (lErr) {
        res.status(500).json({ error: 'query_failed', message: lErr.message });
        return;
      }
      links = lData ?? [];
    }

    const clientIds = Array.from(new Set(links.map((l) => l.client_id)));

    let clientsById = new Map<string, { id: string; client_name: string }>();
    if (clientIds.length > 0) {
      const { data: cData, error: cErr } = await supabase
        .from('clients')
        .select('id, client_name')
        .in('id', clientIds);
      if (cErr) {
        res.status(500).json({ error: 'query_failed', message: cErr.message });
        return;
      }
      clientsById = new Map((cData ?? []).map((c: any) => [String(c.id), { id: String(c.id), client_name: String(c.client_name) }] as const));
    }

    const clientIdForUser = new Map<string, string>();
    for (const l of links) {
      const uid = String(l.agency_user_id);
      const cid = String(l.client_id);
      if (!clientIdForUser.has(uid)) clientIdForUser.set(uid, cid);
    }

    const response = (users ?? []).map((u: any) => {
      const cid = clientIdForUser.get(String(u.id)) ?? null;
      return {
        ...u,
        client_id: cid,
        client: cid ? clientsById.get(cid) ?? null : null,
      };
    });

    res.status(200).json({ data: response });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
