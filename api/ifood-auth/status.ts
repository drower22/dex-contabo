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
import { withCors } from '../_shared/cors';

// 🔍 Validação das variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('[ifood-auth/status] 🔧 Environment check:', {
  hasSupabaseUrl: !!SUPABASE_URL,
  hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrlLength: SUPABASE_URL?.length || 0,
  supabaseKeyLength: SUPABASE_SERVICE_ROLE_KEY?.length || 0
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(`Missing Supabase credentials: URL=${!!SUPABASE_URL}, KEY=${!!SUPABASE_SERVICE_ROLE_KEY}`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const statusHandler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { accountId, scope } = req.query;

  if (!accountId || typeof accountId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid accountId parameter' });
    return;
  }

  if (!scope || (scope !== 'reviews' && scope !== 'financial')) {
    res.status(400).json({ error: 'Missing or invalid scope parameter. Must be "reviews" or "financial"' });
    return;
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
      res.status(500).json({ 
        status: 'error', 
        message: 'Database query failed',
        error: error.message 
      });
      return;
    }

    // Se não há registro, status é 'pending' (apenas resposta; não persiste)
    if (!data || !data.access_token) {
      res.status(200).json({ 
        status: 'pending',
        message: 'No authentication record found for this account and scope'
      });
      return;
    }

    // 2. Descriptografa o access_token
    let accessToken: string;
    try {
      accessToken = await decryptFromB64(data.access_token);
    } catch (decryptError) {
      console.error('[ifood-auth/status] Failed to decrypt token:', decryptError);
      res.status(200).json({ 
        status: 'pending',
        message: 'Token encrypted with legacy scheme or invalid. Please re-link.'
      });
      return;
    }

    // 3. Valida o token na API REAL do iFood (GET /merchants/me)
    try {
      const ifoodResponse = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': process.env.USER_AGENT || 'Dex/1.0',
        },
      });

      if (ifoodResponse.ok) {
        // Token válido! API do iFood respondeu com sucesso
        const merchantData: { id?: string } = await ifoodResponse.json();
        // Persistir conectado e merchant id (quando disponível)
        try {
          await supabase
            .from('ifood_store_auth')
            .update({ status: 'connected', ifood_merchant_id: merchantData?.id ?? data.ifood_merchant_id })
            .eq('account_id', String(accountId))
            .eq('scope', String(scope));
        } catch {}
        res.status(200).json({ 
          status: 'connected',
          message: 'Token validated successfully with iFood API',
          merchantId: merchantData?.id || data.ifood_merchant_id
        });
        return;
      }

      // Token inválido ou expirado: apenas responde, não altera o status salvo
      if (ifoodResponse.status === 401 || ifoodResponse.status === 403) {
        res.status(200).json({ 
          status: 'pending',
          message: 'Token expired or revoked. Please reconnect.',
          httpStatus: ifoodResponse.status
        });
        return;
      }

      // Outros erros da API iFood: apenas responde, não altera o status salvo
      console.error('[ifood-auth/status] iFood API error:', ifoodResponse.status);
      res.status(200).json({ 
        status: 'error',
        message: `iFood API returned ${ifoodResponse.status}`,
        httpStatus: ifoodResponse.status
      });
      return;

    } catch (ifoodError: any) {
      // Erro de rede ou timeout ao chamar API iFood
      console.error('[ifood-auth/status] Failed to call iFood API:', ifoodError);
      res.status(200).json({ 
        status: 'error',
        message: 'Failed to validate token with iFood API',
        error: ifoodError.message
      });
      return;
    }

  } catch (e: any) {
    console.error('[ifood-auth/status] Exception:', e);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: e.message 
    });
    return;
  }
}

export default withCors(statusHandler);
