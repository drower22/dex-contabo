import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

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

    const supabase = createServiceSupabaseClient();

    const { data, error } = await supabase
      .from('agencies')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'query_failed', message: error.message });
      return;
    }

    res.status(200).json({ data: data ?? [] });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
