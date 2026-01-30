import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
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

    const name = asString(req.body?.name ?? req.body?.agency_name ?? req.body?.agencyName).trim();

    if (!name) {
      res.status(400).json({ error: 'missing_name' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase
      .from('agencies')
      .insert({ name })
      .select('id, name')
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
