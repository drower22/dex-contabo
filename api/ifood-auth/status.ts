/**
 * @file api/ifood-auth/status.ts
 * @description Retorna o status em tempo real da conexão iFood para uma loja/escopo.
 *
 * GET /api/ifood-auth/status?accountId=...&scope=reviews|financial
 *
 * Lógica:
 * - Busca o access_token criptografado em ifood_store_auth (por account_id + scope)
 * - Descriptografa usando ENCRYPTION_KEY
 * - Chama merchant/v1.0/merchants/me no iFood
 * - connected: HTTP 200
 * - pending: HTTP 401/403
 * - error: demais códigos ou exceções
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../_shared/crypto';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const accountId = String(req.query.accountId || '').trim();
  const scopeQ = String(req.query.scope || '').trim().toLowerCase();
  const scope = scopeQ === 'financial' ? 'financial' : 'reviews';

  if (!accountId) {
    return res.status(400).json({ error: 'bad_request', message: 'accountId is required' });
  }

  try {
    const { data: auth, error } = await supabase
      .from('ifood_store_auth')
      .select('access_token')
      .eq('account_id', accountId)
      .eq('scope', scope)
      .maybeSingle();

    if (error || !auth?.access_token) {
      return res.status(200).json({ status: 'pending' });
    }

    const accessToken = await decryptFromB64(auth.access_token as string);

    try {
      const resp = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      } as any);

      if (resp.ok) return res.status(200).json({ status: 'connected' });
      if (resp.status === 401 || resp.status === 403) return res.status(200).json({ status: 'pending' });
      return res.status(200).json({ status: 'error' });
    } catch (_) {
      return res.status(200).json({ status: 'error' });
    }
  } catch (e: any) {
    return res.status(500).json({ error: 'internal_error', message: e?.message || String(e) });
  }
}
