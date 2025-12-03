/**
 * @file dex-contabo/api/ifood/financial/payouts.ts
 * @description Endpoint unificado para settlements e antecipações (Contabo deployment)
 * 
 * Este endpoint busca dados financeiros de duas fontes da API do iFood:
 * 1. Settlements (repasses regulares)
 * 2. Anticipations (antecipações de recebíveis)
 * 
 * FUNCIONALIDADE:
 * - GET: Retorna dados brutos das duas APIs em um único response
 * - Busca token automaticamente do Supabase (scope: financial)
 * - Suporta token via Authorization header (opcional)
 * 
 * QUERY PARAMETERS:
 * - accountId (obrigatório): ID interno da conta
 * - from (obrigatório): Data inicial (YYYY-MM-DD)
 * - to (obrigatório): Data final (YYYY-MM-DD)
 * 
 * HEADERS (opcional):
 * - Authorization: Bearer {token} - Se não fornecido, busca do Supabase
 * 
 * RESPONSE:
 * ```json
 * {
 *   "accountId": "abc-123",
 *   "from": "2024-01-01",
 *   "to": "2024-01-31",
 *   "settlements": { ... },
 *   "anticipations": { ... }
 * }
 * ```
 * 
 * APIs DO IFOOD CHAMADAS:
 * - GET /financial/v3/settlements?merchantId=...&beginPaymentDate=...&endPaymentDate=...
 * - GET /financial/v3.0/merchants/{merchantId}/anticipations?beginAnticipatedPaymentDate=...&endAnticipatedPaymentDate=...
 * 
 * @example
 * GET /api/ifood/financial/payouts?accountId=abc-123&from=2024-01-01&to=2024-01-31
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
    // 1. Busca access token do Supabase (scope: financial)
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
        // Descriptografar se necessário (assumindo que está criptografado)
        // Por ora, vamos assumir que está em texto plano ou usar helper de crypto
        accessToken = auth.access_token as string;
      }
    }

    if (!accessToken) {
      return res.status(401).json({ 
        error: 'No access token found',
        message: 'Financial scope not authorized for this account'
      });
    }

    // 2. Busca merchantId do account
    const { data: account } = await supabase
      .from('accounts')
      .select('ifood_merchant_id')
      .eq('id', accountId)
      .single();

    if (!account?.ifood_merchant_id) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const merchantId = account.ifood_merchant_id;

    // 3. Montar chamadas via proxydex (ou fallback direto se não configurado)
    // Settlements: /financial/v3.0/merchants/{merchantId}/settlements?beginPaymentDate=...&endPaymentDate=...
    // Anticipations: /financial/v3.0/merchants/{merchantId}/anticipations?beginAnticipatedPaymentDate=...&endAnticipatedPaymentDate=...

    const settlementsQuery = new URLSearchParams({
      beginPaymentDate: from,
      endPaymentDate: to,
    }).toString();
    const settlementsPath = `/financial/v3.0/merchants/${merchantId}/settlements?${settlementsQuery}`;

    const anticipationsQuery = new URLSearchParams({
      beginAnticipatedPaymentDate: from,
      endAnticipatedPaymentDate: to,
    }).toString();
    const anticipationsPath = `/financial/v3.0/merchants/${merchantId}/anticipations?${anticipationsQuery}`;

    let settlementsData: any = null;
    let anticipationsData: any = null;

    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      // Usar proxydex (Vercel) para ambas as chamadas
      const settlementsUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(settlementsPath)}`;
      const anticipationsUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(anticipationsPath)}`;

      console.log('[payouts] 🔄 Using proxy for settlements:', settlementsUrl);
      console.log('[payouts] 🔄 Using proxy for anticipations:', anticipationsUrl.replace(IFOOD_PROXY_KEY, '***'));

      const [settlementsResponse, anticipationsResponse] = await Promise.all([
        fetch(settlementsUrl, {
          method: 'GET',
          headers: {
            'x-shared-key': IFOOD_PROXY_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'accept': 'application/json',
          },
        }),
        fetch(anticipationsUrl, {
          method: 'GET',
          headers: {
            'x-shared-key': IFOOD_PROXY_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'accept': 'application/json',
          },
        }),
      ]);

      if (settlementsResponse.ok) {
        settlementsData = await settlementsResponse.json();
      } else {
        const txt = await settlementsResponse.text();
        console.error('[payouts] ❌ Settlements via proxy failed:', settlementsResponse.status, txt);
      }

      if (anticipationsResponse.ok) {
        anticipationsData = await anticipationsResponse.json();
      } else {
        const txt = await anticipationsResponse.text();
        console.error('[payouts] ❌ Anticipations via proxy failed:', anticipationsResponse.status, txt);
      }
    } else {
      // Fallback: chamada direta (não recomendada em produção)
      const settlementsUrl = `${IFOOD_BASE_URL}${settlementsPath}`;
      const settlementsResponse = await fetch(settlementsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'accept': 'application/json',
        },
      });

      if (settlementsResponse.ok) {
        settlementsData = await settlementsResponse.json();
      }

      const anticipationsUrl = `${IFOOD_BASE_URL}${anticipationsPath}`;
      const anticipationsResponse = await fetch(anticipationsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'accept': 'application/json',
        },
      });

      if (anticipationsResponse.ok) {
        anticipationsData = await anticipationsResponse.json();
      }
    }

    // 5. Retorna os dados brutos das duas APIs
    return res.status(200).json({
      accountId,
      from,
      to,
      settlements: settlementsData,
      anticipations: anticipationsData,
    });

  } catch (e: any) {
    console.error('[payouts] Exception:', e);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: e.message 
    });
  }
}
