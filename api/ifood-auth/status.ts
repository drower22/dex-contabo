/**
 * @file dex-contabo/api/ifood-auth/status.ts
 * @description Verifica status da autenticação iFood validando na API real (Contabo deployment)
 * 
 * Versão do status.ts para deployment no Contabo.
 * Rota serverless que verifica o status da autenticação iFood fazendo uma chamada REAL
 * para a API do iFood (GET /merchants/me) para validar se o token está ativo.
 *
 * Query Parameters:
 * - accountId (obrigatório): ID interno da conta/loja no sistema
 * - scope (obrigatório): 'reviews' ou 'financial'
 *
 * Retorna:
 * - { status: 'connected' | 'pending' | 'error', message?: string }
 *
 * Variáveis de ambiente utilizadas:
 * - SUPABASE_URL (obrigatória)
 * - SUPABASE_SERVICE_ROLE_KEY (obrigatória)
 * - IFOOD_BASE_URL (opcional, default: https://merchant-api.ifood.com.br)
 * - CORS_ORIGIN (opcional)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../_shared/crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

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

  const { accountId, scope } = req.query;

  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid accountId parameter' });
  }

  if (!scope || (scope !== 'reviews' && scope !== 'financial')) {
    return res.status(400).json({ error: 'Missing or invalid scope parameter. Must be "reviews" or "financial"' });
  }

  try {
    // 1. Busca o access_token no Supabase
    const { data, error } = await supabase
      .from('ifood_store_auth')
      .select('access_token, refresh_token, expires_at, ifood_merchant_id')
      .eq('account_id', accountId)
      .eq('scope', scope)
      .maybeSingle();

    if (error) {
      console.error('[ifood-auth/status] Supabase error:', error);
      return res.status(500).json({ 
        status: 'error', 
        message: 'Database query failed',
        error: error.message 
      });
    }

    // Se não há registro, status é 'pending'
    if (!data || !data.access_token) {
      return res.status(200).json({ 
        status: 'pending',
        message: 'No authentication record found for this account and scope'
      });
    }

    // 2. Descriptografa o access_token
    let accessToken: string;
    try {
      accessToken = await decryptFromB64(data.access_token);
    } catch (decryptError) {
      console.error('[ifood-auth/status] Failed to decrypt token:', decryptError);
      return res.status(200).json({ 
        status: 'error',
        message: 'Failed to decrypt access token'
      });
    }

    // 3. Valida o token na API REAL do iFood (GET /merchants/me)
    try {
      const ifoodResponse = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (ifoodResponse.ok) {
        // Token válido! API do iFood respondeu com sucesso
        const merchantData = await ifoodResponse.json();
        return res.status(200).json({ 
          status: 'connected',
          message: 'Token validated successfully with iFood API',
          merchantId: merchantData?.id || data.ifood_merchant_id
        });
      }

      // Token inválido ou expirado
      if (ifoodResponse.status === 401 || ifoodResponse.status === 403) {
        return res.status(200).json({ 
          status: 'error',
          message: 'Token expired or revoked. Please reconnect.',
          httpStatus: ifoodResponse.status
        });
      }

      // Outros erros da API iFood
      console.error('[ifood-auth/status] iFood API error:', ifoodResponse.status);
      return res.status(200).json({ 
        status: 'error',
        message: `iFood API returned ${ifoodResponse.status}`,
        httpStatus: ifoodResponse.status
      });

    } catch (ifoodError: any) {
      // Erro de rede ou timeout ao chamar API iFood
      console.error('[ifood-auth/status] Failed to call iFood API:', ifoodError);
      return res.status(200).json({ 
        status: 'error',
        message: 'Failed to validate token with iFood API',
        error: ifoodError.message
      });
    }

  } catch (e: any) {
    console.error('[ifood-auth/status] Exception:', e);
    return res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: e.message 
    });
  }
}
