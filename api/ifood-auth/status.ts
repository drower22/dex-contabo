/**
 * @file dex-contabo/api/ifood-auth/status.ts
 * @description Verifica status da autenticação iFood (Contabo deployment)
 * 
 * Versão do status.ts para deployment no Contabo.
 * Rota serverless que verifica o status da autenticação iFood para uma conta específica.
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
 * - CORS_ORIGIN (opcional)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

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

  const { accountId, scope } = req.query;

  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid accountId parameter' });
  }

  if (!scope || (scope !== 'reviews' && scope !== 'financial')) {
    return res.status(400).json({ error: 'Missing or invalid scope parameter. Must be "reviews" or "financial"' });
  }

  try {
    // Busca o registro de autenticação no Supabase
    const { data, error } = await supabase
      .from('ifood_store_auth')
      .select('status, refresh_token, access_token, expires_at')
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
    if (!data) {
      return res.status(200).json({ 
        status: 'pending',
        message: 'No authentication record found for this account and scope'
      });
    }

    // Verifica se tem refresh_token válido
    if (!data.refresh_token) {
      return res.status(200).json({ 
        status: 'pending',
        message: 'Authentication not completed - missing refresh token'
      });
    }

    // Verifica se o token está expirado (se houver expires_at)
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      
      if (expiresAt < now) {
        // Token expirado, mas ainda pode ser renovado com refresh_token
        return res.status(200).json({ 
          status: 'connected',
          message: 'Token expired but can be refreshed',
          expired: true
        });
      }
    }

    // Retorna o status armazenado no banco
    const storedStatus = (data.status || '').toLowerCase();
    
    if (storedStatus === 'connected' || storedStatus === 'active') {
      return res.status(200).json({ 
        status: 'connected',
        message: 'Authentication active'
      });
    }

    if (storedStatus === 'error' || storedStatus === 'failed') {
      return res.status(200).json({ 
        status: 'error',
        message: 'Authentication failed or revoked'
      });
    }

    // Default para pending
    return res.status(200).json({ 
      status: 'pending',
      message: 'Authentication in progress'
    });

  } catch (e: any) {
    console.error('[ifood-auth/status] Exception:', e);
    return res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: e.message 
    });
  }
}
