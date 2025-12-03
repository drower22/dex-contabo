/**
 * @file api/ifood-financial/payouts-unified.ts
 * @description Endpoint unificado para buscar settlements + anticipations
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../../_shared/crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

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

  const { storeId, beginDate, endDate } = req.query;

  if (!storeId || typeof storeId !== 'string') {
    return res.status(400).json({ error: 'Missing storeId parameter' });
  }

  try {
    // Buscar access_token do Supabase
    const { data: authData } = await supabase
      .from('ifood_store_auth')
      .select('access_token')
      .eq('account_id', storeId)
      .eq('scope', 'financial')
      .eq('status', 'connected')
      .maybeSingle();

    if (!authData?.access_token) {
      return res.status(401).json({ error: 'No valid financial token found' });
    }

    const accessToken = await decryptFromB64(authData.access_token);

    // Construir paths financeiros (v3.0 merchants)
    const query = new URLSearchParams();
    if (beginDate) query.set('beginPaymentDate', String(beginDate));
    if (endDate) query.set('endPaymentDate', String(endDate));

    // Para esse endpoint usamos storeId como accountId -> buscar merchantId associado
    const { data: account } = await supabase
      .from('accounts')
      .select('ifood_merchant_id')
      .eq('id', storeId)
      .maybeSingle();

    if (!account?.ifood_merchant_id) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const merchantId = account.ifood_merchant_id;

    const settlementsPath = `/financial/v3.0/merchants/${merchantId}/settlements?${query.toString()}`;
    const anticipationsPath = `/financial/v3.0/merchants/${merchantId}/anticipations?${
      new URLSearchParams({
        beginAnticipatedPaymentDate: String(beginDate || ''),
        endAnticipatedPaymentDate: String(endDate || ''),
      }).toString()
    }`;

    let settlements: any = { items: [] };
    let anticipations: any = { items: [] };

    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      const settlementsUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(settlementsPath)}`;
      const anticipationsUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(anticipationsPath)}`;

      console.log('[payouts-unified] 🔄 Using proxy', { settlementsUrl, anticipationsUrl: anticipationsUrl.replace(IFOOD_PROXY_KEY, '***') });

      const [settlementsRes, anticipationsRes] = await Promise.all([
        fetch(settlementsUrl, {
          method: 'GET',
          headers: {
            'x-shared-key': IFOOD_PROXY_KEY!,
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }),
        fetch(anticipationsUrl, {
          method: 'GET',
          headers: {
            'x-shared-key': IFOOD_PROXY_KEY!,
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }),
      ]);

      settlements = settlementsRes.ok ? await settlementsRes.json() : { items: [] };
      anticipations = anticipationsRes.ok ? await anticipationsRes.json() : { items: [] };
    } else {
      // Fallback direto (não recomendado)
      const settlementsUrl = `${IFOOD_BASE_URL}${settlementsPath}`;
      const anticipationsUrl = `${IFOOD_BASE_URL}${anticipationsPath}`;

      const [settlementsRes, anticipationsRes] = await Promise.all([
        fetch(settlementsUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
        fetch(anticipationsUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      ]);

      settlements = settlementsRes.ok ? await settlementsRes.json() : { items: [] };
      anticipations = anticipationsRes.ok ? await anticipationsRes.json() : { items: [] };
    }

    return res.status(200).json({
      settlements: settlements.items || [],
      anticipations: anticipations.items || [],
      unified: [
        ...(settlements.items || []).map((s: any) => ({ ...s, type: 'settlement' })),
        ...(anticipations.items || []).map((a: any) => ({ ...a, type: 'anticipation' })),
      ],
    });

  } catch (error: any) {
    console.error('[payouts-unified] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
