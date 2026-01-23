import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function normalizeEnvValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function parseAllowlist(raw: unknown): string[] {
  const normalized = normalizeEnvValue(raw);
  if (!normalized) return [];
  return normalized
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getAdminEmailAllowlist(): string[] {
  const raw = normalizeEnvValue(process.env.ADMIN_EMAIL_ALLOWLIST);
  if (process.env.NODE_ENV === 'production') {
    console.log('[admin-auth] startup env debug', {
      rawEnvValue: raw,
      parsedAllowlist: parseAllowlist(raw),
    });
  }
  return parseAllowlist(raw);
}

export function getBearerToken(headerValue: unknown): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

export async function requireAdminUser(req: any): Promise<{ email: string; userId: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[admin-auth] missing supabase config', {
      hasUrl: Boolean(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    });
    throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured');
  }

  const token = getBearerToken(req.headers?.authorization ?? req.headers?.Authorization);
  if (!token) {
    console.warn('[admin-auth] missing bearer token');
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    console.warn('[admin-auth] getUser failed', {
      message: error?.message ?? null,
      hasUser: Boolean(data?.user),
    });
    return null;
  }

  const email = String(data.user.email || '').toLowerCase();
  const userId = String(data.user.id || '');
  if (!email || !userId) return null;

  const allowlist = getAdminEmailAllowlist();
  const allowEmptyAllowlistInDev = process.env.NODE_ENV !== 'production' && allowlist.length === 0;
  const allowed = allowEmptyAllowlistInDev || allowlist.includes(email);
  if (!allowed) {
    console.warn('[admin-auth] email not allowlisted', {
      email,
      allowlistCount: allowlist.length,
      nodeEnv: process.env.NODE_ENV,
      allowEmptyAllowlistInDev,
    });
    return null;
  }

  return { email, userId };
}

export function createServiceSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
