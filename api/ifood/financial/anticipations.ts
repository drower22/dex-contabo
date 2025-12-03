/**
 * @file dex-contabo/api/ifood/financial/anticipations.ts
 * @description Endpoint para listar antecipações do iFood (Contabo deployment)
 * 
 * Retorna apenas dados de antecipações (recebíveis antecipados).
 * Endpoint de debug/desenvolvimento para testar integração isolada.
 * 
 * FUNCIONALIDADE:
 * - GET: Lista antecipações para período específico
 * - Busca token do Supabase ou aceita via header
 * 
 * QUERY PARAMETERS:
 * - accountId (obrigatório): ID interno da conta
 * - from (obrigatório): Data inicial (YYYY-MM-DD)
 * - to (obrigatório): Data final (YYYY-MM-DD)
 * 
 * API DO IFOOD:
 * - GET /financial/v3.0/merchants/{merchantId}/anticipations
 * - Parâmetros: beginAnticipatedPaymentDate, endAnticipatedPaymentDate
 * 
 * @example
 * GET /api/ifood/financial/anticipations?accountId=abc-123&from=2024-01-01&to=2024-01-31
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim(); // ex: https://proxy.usa-dex.com.br/api/ifood-proxy
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

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

    // Chama API iFood para antecipações via proxy ou direto
    // Endpoint correto: /financial/v3.0/merchants/{merchantId}/anticipations
    let url: string;
    let headers: Record<string, string>;

    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      // Usar proxy (recomendado - evita bloqueio de IP)
      const path = `financial/v3.0/merchants/${merchantId}/anticipations`;
      url = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}&beginAnticipatedPaymentDate=${from}&endAnticipatedPaymentDate=${to}`;
      headers = {
        'x-shared-key': IFOOD_PROXY_KEY,
        'x-ifood-token': accessToken,
        'accept': 'application/json',
      };
      console.log('[anticipations] 🔄 Using proxy:', { url: url.replace(IFOOD_PROXY_KEY, '***') });
    } else {
      // Fallback: chamada direta (pode ser bloqueada)
      url = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/anticipations?beginAnticipatedPaymentDate=${from}&endAnticipatedPaymentDate=${to}`;
      headers = {
        'Authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
      };
      console.log('[anticipations] ⚠️  Using direct call (may be blocked):', url);
    }

    const response = await fetch(url, { headers });

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
