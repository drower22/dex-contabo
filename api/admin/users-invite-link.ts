import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
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

    const userId = asString(req.body?.user_id ?? req.body?.userId).trim();
    const email = asString(req.body?.email).trim().toLowerCase();

    const supabase = createServiceSupabaseClient();

    let targetEmail = email;
    if (!targetEmail && userId) {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user?.email) {
        res.status(400).json({ error: 'invalid_user_id', message: error?.message || 'Could not resolve user email' });
        return;
      }
      targetEmail = String(data.user.email).toLowerCase();
    }

    if (!targetEmail || !targetEmail.includes('@')) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }

    const redirectTo = getRedirectTo(req);

    const adminAny = supabase.auth.admin as any;
    if (typeof adminAny.generateLink !== 'function') {
      res.status(501).json({ error: 'generate_link_not_supported' });
      return;
    }

    // Prefer invite link; if it fails, fallback to recovery link.
    let linkType: 'invite' | 'recovery' = 'invite';
    let linkResp: any = null;

    const { data: inviteData, error: inviteErr } = await adminAny.generateLink({
      type: 'invite',
      email: targetEmail,
      options: { redirectTo },
    });

    if (inviteErr || !inviteData?.properties?.action_link) {
      linkType = 'recovery';
      const { data: recData, error: recErr } = await adminAny.generateLink({
        type: 'recovery',
        email: targetEmail,
        options: { redirectTo },
      });
      if (recErr || !recData?.properties?.action_link) {
        res.status(500).json({ error: 'generate_link_failed', message: (inviteErr?.message || recErr?.message || 'Failed') });
        return;
      }
      linkResp = recData;
    } else {
      linkResp = inviteData;
    }

    res.status(200).json({
      data: {
        email: targetEmail,
        type: linkType,
        action_link: String(linkResp.properties.action_link),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
