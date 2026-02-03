import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../../_shared/crypto';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resolveMerchantId(accountId: string): Promise<string | null> {
  // 1) Preferir auth do escopo financeiro
  const { data: authStoreFinancial } = await supabase
    .from('ifood_store_auth')
    .select('ifood_merchant_id')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromAuthFinancial = (authStoreFinancial as any)?.ifood_merchant_id;
  if (typeof fromAuthFinancial === 'string' && fromAuthFinancial.trim()) return fromAuthFinancial.trim();

  // 2) Fallback: qualquer scope (ex: reviews) pode ter o merchant salvo
  const { data: authStoreAny } = await supabase
    .from('ifood_store_auth')
    .select('ifood_merchant_id')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromAuthAny = (authStoreAny as any)?.ifood_merchant_id;
  if (typeof fromAuthAny === 'string' && fromAuthAny.trim()) return fromAuthAny.trim();

  const { data: account } = await supabase
    .from('accounts')
    .select('ifood_merchant_id')
    .eq('id', accountId)
    .maybeSingle();

  const fromAccounts = (account as any)?.ifood_merchant_id;
  return typeof fromAccounts === 'string' && fromAccounts.trim() ? fromAccounts.trim() : null;
}

async function resolveAccessToken(accountId: string, authHeader?: string): Promise<string | null> {
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    return t || null;
  }

  const { data: auth } = await supabase
    .from('ifood_store_auth')
    .select('access_token')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = (auth as any)?.access_token;
  if (!raw || typeof raw !== 'string') return null;

  try {
    const decrypted = await decryptFromB64(raw);
    return decrypted || raw;
  } catch {
    return raw;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : '';
  const merchantIdFromQuery = typeof req.query.merchantId === 'string' ? req.query.merchantId : '';
  const beginDate = typeof req.query.beginDate === 'string' ? req.query.beginDate : '';
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : '';
  const page = typeof req.query.page === 'string' ? req.query.page : '1';
  const size = typeof req.query.size === 'string' ? req.query.size : '100';

  if (!accountId) return res.status(400).json({ error: 'Missing accountId parameter' });
  if (!beginDate || !endDate) return res.status(400).json({ error: 'Missing beginDate/endDate parameters (YYYY-MM-DD)' });

  try {
    const accessToken = await resolveAccessToken(accountId, String(req.headers.authorization || ''));
    if (!accessToken) {
      return res.status(401).json({
        error: 'No access token found',
        message: 'Financial scope not authorized for this account',
      });
    }

    const merchantId = merchantIdFromQuery?.trim() || (await resolveMerchantId(accountId));
    if (!merchantId) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const qs = new URLSearchParams({
      merchantId,
      beginDate,
      endDate,
      page,
      size,
    }).toString();

    // Conforme a doc da API Financial Events, merchantId é parâmetro de busca (query)
    // Endpoint esperado: GET /financial/v3/financialEvents?merchantId=...&beginDate=...&endDate=...&page=...&size=...
    const path = `/financial/v3/financialEvents?${qs}`;

    let url: string;
    let headers: Record<string, string>;

    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      url = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;
      headers = {
        'x-shared-key': IFOOD_PROXY_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };
    } else {
      url = `${IFOOD_BASE_URL}${path}`;
      headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      };
    }

    const response = await fetch(url, { method: 'GET', headers });
    const text = await response.text();

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'iFood API error',
        status: response.status,
        body: json ?? text,
      });
    }

    return res.status(200).json(json ?? { raw: text });
  } catch (e: any) {
    return res.status(500).json({
      error: 'Internal server error',
      message: e?.message || String(e),
    });
  }
}
