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

    const userId = asString(
      req.params?.userId ??
        req.query?.userId ??
        req.query?.id ??
        req.query?.user_id
    ).trim();
    const clientId = asString(req.body?.client_id ?? req.body?.clientId).trim();

    if (!userId) {
      res.status(400).json({ error: 'missing_user_id' });
      return;
    }
    if (!clientId) {
      res.status(400).json({ error: 'missing_client_id' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: user, error: userErr } = await supabase
      .from('agency_users')
      .select('id, role, agency_id')
      .eq('id', userId)
      .single();

    if (userErr) {
      res.status(500).json({ error: 'query_failed', message: userErr.message });
      return;
    }

    if (!user || String((user as any).role) !== 'client_user') {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, agency_id')
      .eq('id', clientId)
      .single();

    if (clientErr) {
      res.status(500).json({ error: 'query_failed', message: clientErr.message });
      return;
    }

    if (!client || String((client as any).agency_id) !== String((user as any).agency_id)) {
      res.status(400).json({ error: 'client_agency_mismatch' });
      return;
    }

    const { error: delErr } = await supabase.from('agency_user_clients').delete().eq('agency_user_id', userId);
    if (delErr) {
      res.status(500).json({ error: 'unlink_failed', message: delErr.message });
      return;
    }

    const { error: upsertErr } = await supabase
      .from('agency_user_clients')
      .upsert([{ agency_user_id: userId, client_id: clientId }], { onConflict: 'agency_user_id,client_id' });

    if (upsertErr) {
      res.status(500).json({ error: 'link_failed', message: upsertErr.message });
      return;
    }

    res.status(200).json({ data: { user_id: userId, client_id: clientId } });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
