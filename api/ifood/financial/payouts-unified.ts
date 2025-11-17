/**
 * @file api/ifood-financial/payouts-unified.ts
 * @description Endpoint unificado para buscar settlements + anticipations
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../_shared/crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();

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

    // Buscar settlements
    const settlementsUrl = new URL(`${IFOOD_BASE_URL}/financial/v3/settlements`);
    if (beginDate) settlementsUrl.searchParams.set('beginDate', String(beginDate));
    if (endDate) settlementsUrl.searchParams.set('endDate', String(endDate));

    const settlementsRes = await fetch(settlementsUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Buscar anticipations
    const anticipationsUrl = new URL(`${IFOOD_BASE_URL}/financial/v1/anticipations`);
    if (beginDate) anticipationsUrl.searchParams.set('beginDate', String(beginDate));
    if (endDate) anticipationsUrl.searchParams.set('endDate', String(endDate));

    const anticipationsRes = await fetch(anticipationsUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const settlements = settlementsRes.ok ? await settlementsRes.json() : { items: [] };
    const anticipations = anticipationsRes.ok ? await anticipationsRes.json() : { items: [] };

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
