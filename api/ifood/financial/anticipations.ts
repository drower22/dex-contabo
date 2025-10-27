/**
 * @file api/ifood/financial/anticipations.ts
 * @description Endpoint de debug para listar apenas antecipações
 * 
 * GET /api/ifood/financial/anticipations?accountId=...&from=...&to=...
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

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

  const { accountId, from, to } = req.query;
  const authHeader = req.headers.authorization;

  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid accountId parameter' });
  }

  if (!from || typeof from !== 'string' || !to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid from/to date parameters (YYYY-MM-DD)' });
  }

  try {
    // Busca access token
    let accessToken: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    } else {
      const { data: auth } = await supabase
        .from('ifood_store_auth')
        .select('access_token')
        .eq('account_id', accountId)
        .eq('scope', 'financial')
        .maybeSingle();

      if (auth?.access_token) {
        accessToken = auth.access_token as string;
      }
    }

    if (!accessToken) {
      return res.status(401).json({ 
        error: 'No access token found',
        message: 'Financial scope not authorized for this account'
      });
    }

    // Busca merchantId
    const { data: account } = await supabase
      .from('accounts')
      .select('ifood_merchant_id')
      .eq('id', accountId)
      .single();

    if (!account?.ifood_merchant_id) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const merchantId = account.ifood_merchant_id;

    // Chama API iFood para antecipações
    // Endpoint correto: /financial/v3.0/merchants/{merchantId}/anticipations
    const url = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/anticipations?beginAnticipatedPaymentDate=${from}&endAnticipatedPaymentDate=${to}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: 'iFood API error',
        status: response.status,
        message: errorText 
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e: any) {
    console.error('[anticipations] Exception:', e);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: e.message 
    });
  }
}
