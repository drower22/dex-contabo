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

function getRedirectTo(req: any): string {
  const fromEnv = (process.env.FRONTEND_URL || process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '').trim();
  if (fromEnv) return `${fromEnv.replace(/\/$/, '')}/reset-password`;

  const forwardedHost = asString(req.headers?.['x-forwarded-host'] ?? req.headers?.host).trim();
  const forwardedProto = asString(req.headers?.['x-forwarded-proto']).trim() || 'https';
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}/reset-password`;

  return 'https://app.usa-dex.com.br/reset-password';
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

    const email = asString(req.body?.email).trim().toLowerCase();
    const agencyId = asString(req.body?.agency_id ?? req.body?.agencyId).trim();
    const clientIds = asStringArray(req.body?.client_ids ?? req.body?.clientIds);

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    if (!agencyId) {
      res.status(400).json({ error: 'missing_agency_id' });
      return;
    }
    if (!clientIds.length) {
      res.status(400).json({ error: 'missing_client_ids' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: existingAgencyUser, error: existingAgencyUserErr } = await supabase
      .from('agency_users')
      .select('id, email')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (existingAgencyUserErr) {
      res.status(500).json({ error: 'agency_user_lookup_failed', message: existingAgencyUserErr.message });
      return;
    }

    const redirectTo = getRedirectTo(req);

    let userId: string | null = null;
    const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (!inviteErr && invited?.user?.id) {
      userId = String(invited.user.id);
    }

    // If user already exists, invite can fail (varies by Supabase config). In that case,
    // fallback to sending a password recovery email (also sends email), but we still need the userId.
    if (!userId) {
      const errMsg = String(inviteErr?.message ?? '').toLowerCase();
      const mightBeExisting = errMsg.includes('already') || errMsg.includes('registered') || errMsg.includes('exists');
      if (!mightBeExisting) {
        res.status(500).json({ error: 'auth_invite_failed', message: inviteErr?.message ?? 'Invite failed' });
        return;
      }

      const { data: lookup, error: lookupErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (lookupErr) {
        res.status(500).json({ error: 'auth_list_users_failed', message: lookupErr.message });
        return;
      }
      const existingUser = (lookup?.users ?? []).find((u: any) => String(u.email || '').toLowerCase() === email) ?? null;
      if (!existingUser?.id) {
        res.status(500).json({ error: 'auth_lookup_failed', message: 'Could not resolve existing user id' });
        return;
      }
      userId = String(existingUser.id);

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetErr) {
        res.status(500).json({ error: 'auth_reset_failed', message: resetErr.message });
        return;
      }
    }

    // If there is already an agency_users record with this email, always reuse its id.
    // This makes the operation idempotent even if Auth userId differs.
    if (existingAgencyUser?.id) {
      userId = String(existingAgencyUser.id);
    }

    const { error: upsertErr } = await supabase
      .from('agency_users')
      .upsert({ id: userId, email, agency_id: agencyId, role: 'manager', is_active: true }, { onConflict: 'id' });

    if (upsertErr) {
      const msg = String(upsertErr.message || '');
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        res.status(409).json({ error: 'duplicate_email', message: upsertErr.message });
        return;
      }
      res.status(500).json({ error: 'agency_users_upsert_failed', message: upsertErr.message });
      return;
    }

    const inserts = clientIds.map((clientId) => ({ agency_user_id: userId, client_id: clientId }));

    const { error: linkErr } = await supabase
      .from('agency_user_clients')
      .upsert(inserts, { onConflict: 'agency_user_id,client_id' });

    if (linkErr) {
      res.status(500).json({ error: 'link_clients_failed', message: linkErr.message });
      return;
    }

    res.status(200).json({ data: { user_id: userId, email, agency_id: agencyId, client_ids: clientIds } });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
