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
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const agencyId = asString(req.body?.agency_id ?? req.body?.agencyId).trim();
    const clientId = asString(req.body?.client_id ?? req.body?.clientId).trim();
    const accountName = asString(req.body?.account_name ?? req.body?.accountName ?? req.body?.name).trim();
    const isActive = asBoolean(req.body?.is_active ?? req.body?.isActive);

    if (!agencyId) {
      res.status(400).json({ error: 'missing_agency_id' });
      return;
    }
    if (!clientId) {
      res.status(400).json({ error: 'missing_client_id' });
      return;
    }
    if (!accountName) {
      res.status(400).json({ error: 'missing_account_name' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: client, error: clientErr } = await supabase.from('clients').select('id, agency_id').eq('id', clientId).single();
    if (clientErr) {
      res.status(500).json({ error: 'query_failed', message: clientErr.message });
      return;
    }
    if (!client || String((client as any).agency_id) !== agencyId) {
      res.status(400).json({ error: 'client_agency_mismatch' });
      return;
    }

    const { data, error } = await supabase
      .from('accounts')
      .insert({ agency_id: agencyId, client_id: clientId, account_name: accountName, is_active: isActive === null ? true : isActive })
      .select('id, account_name, client_id, agency_id, ifood_merchant_id, is_active')
      .single();

    if (error) {
      res.status(500).json({ error: 'insert_failed', message: error.message });
      return;
    }

    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
