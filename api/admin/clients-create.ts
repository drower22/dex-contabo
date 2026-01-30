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
    const clientName = asString(req.body?.client_name ?? req.body?.clientName).trim();
    const isActive = asBoolean(req.body?.is_active ?? req.body?.isActive);

    if (!agencyId) {
      res.status(400).json({ error: 'missing_agency_id' });
      return;
    }
    if (!clientName) {
      res.status(400).json({ error: 'missing_client_name' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase
      .from('clients')
      .insert({ agency_id: agencyId, client_name: clientName, is_active: isActive === null ? true : isActive })
      .select('id, client_name, agency_id, is_active, created_at')
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
