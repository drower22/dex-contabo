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
      .select('id, email, agency_id, role, created_at')
      .eq('role', 'manager')
      .order('created_at', { ascending: false });

    if (agencyId) q = q.eq('agency_id', agencyId);

    const { data: managers, error: mErr } = await q;
    if (mErr) {
      res.status(500).json({ error: 'query_failed', message: mErr.message });
      return;
    }

    const managerIds = (managers ?? []).map((m: any) => m.id);

    let links: any[] = [];
    if (managerIds.length > 0) {
      const { data: lData, error: lErr } = await supabase
        .from('agency_user_clients')
        .select('agency_user_id, client_id')
        .in('agency_user_id', managerIds);

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
      clientsById = new Map((cData ?? []).map((c: any) => [c.id, { id: c.id, client_name: c.client_name }] as const));
    }

    const clientsForManager = new Map<string, { id: string; client_name: string }[]>();
    for (const l of links) {
      const cid = String(l.client_id);
      const uid = String(l.agency_user_id);
      const c = clientsById.get(cid);
      if (!c) continue;
      const arr = clientsForManager.get(uid) ?? [];
      arr.push(c);
      clientsForManager.set(uid, arr);
    }

    const response = (managers ?? []).map((m: any) => {
      const arr = clientsForManager.get(String(m.id)) ?? [];
      return {
        ...m,
        clients: arr,
        client_count: arr.length,
      };
    });

    res.status(200).json({ data: response });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
