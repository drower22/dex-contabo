/**
 * @file dex-contabo/api/ifood-auth/link.ts
 * @description Gera userCode para vínculo OAuth (Contabo deployment) - COM LOGS DE DEBUG
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { buildIFoodUrl, withIFoodProxy } from '../_shared/proxy';
import axios from 'axios';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('\n========== [LINK] INÍCIO DA REQUISIÇÃO ==========');
  console.log('[LINK] 📥 Method:', req.method);
  console.log('[LINK] 📥 URL:', req.url);
  console.log('[LINK] 📥 Query:', JSON.stringify(req.query, null, 2));
  console.log('[LINK] 📥 Body:', JSON.stringify(req.body, null, 2));
  
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    console.log('[LINK] ✅ OPTIONS request - returning 200');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('[LINK] ❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { accountId, merchantId } = req.body;
  const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[ifood-auth/link] ⇢ start', { traceId, accountId, merchantId, scopeParam, scope });

  try {
    if (!accountId) {
      console.warn('[ifood-auth/link] Missing accountId', { traceId, body: req.body });
      return res.status(400).json({ error: 'accountId (ID interno) é obrigatório' });
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('id, ifood_merchant_id')
      .eq('id', accountId)
      .single();

    if (!account?.id) {
      console.warn('[ifood-auth/link] Account not found', { traceId, accountId });
      return res.status(404).json({ error: 'Conta não encontrada para o accountId informado' });
    }

    // Garante que o merchantId seja salvo no primeiro vínculo
    if (merchantId) {
      const { error: upsertError } = await supabase
        .from('ifood_store_auth')
        .upsert({ account_id: account.id, ifood_merchant_id: merchantId, scope: scope || 'reviews' }, { onConflict: 'account_id,scope' });

      if (upsertError) {
        console.error('[ifood-auth/link] Error saving merchantId', { traceId, upsertError });
        // Não bloqueia o fluxo, mas loga o erro
      }
    }

    // Usar apenas variáveis específicas por scope (sem fallback genérico)
    const clientId = scope === 'financial'
      ? process.env.IFOOD_CLIENT_ID_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_ID_REVIEWS
        : undefined;

    console.log('[ifood-auth/link] 🔑 Credentials check:', {
      scope,
      hasClientIdFinancial: !!process.env.IFOOD_CLIENT_ID_FINANCIAL,
      hasClientIdReviews: !!process.env.IFOOD_CLIENT_ID_REVIEWS,
      selectedClientId: clientId ? `${clientId.substring(0, 8)}...` : 'undefined'
    });

    if (!clientId) {
      console.log('[ifood-auth/link] ❌ Missing client credentials for scope:', scope);
      return res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} not configured`
      });
    }

    const requestBody = new URLSearchParams({
      clientId: clientId,  // ✅ CORRIGIDO: camelCase
    });

    console.log('[ifood-auth/link] 📤 Sending request to iFood API:', {
      url: `${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyParams: { clientId: `${clientId.substring(0, 8)}...` }
    });

    const url = buildIFoodUrl('/authentication/v1.0/oauth/userCode');
    let data: any;
    try {
      const response = await axios.post(url, requestBody, {
        headers: Object.fromEntries(
          (withIFoodProxy({ headers: {} }).headers as Headers).entries()
        ),
        responseType: 'json',
      });
      data = response.data;
      console.log('[ifood-auth/link] ✅ iFood API response body:', JSON.stringify(data, null, 2));
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error('[ifood-auth/link] ❌ Axios error calling iFood API', {
          traceId,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return res.status(error.response?.status || 500).json({ 
          error: 'Falha ao solicitar código de autorização do iFood',
          details: error.response?.data 
        });
      } else {
        console.error('[ifood-auth/link] ❌ Generic error calling iFood API', {
          traceId,
          error: error?.message,
        });
        throw error;
      }
    }

    await supabase
      .from('ifood_store_auth')
      .upsert({
        account_id: account.id,
        scope: scope || 'reviews',
        link_code: data.userCode,
        verifier: data.authorizationCodeVerifier,
        status: 'pending',
      }, { onConflict: 'account_id,scope' });

    console.log('[ifood-auth/link] Link stored successfully', { traceId, accountId: account.id, scope });

    res.status(200).json({
      ...data,
      account_id: account.id,
    });
  } catch (error: any) {
    console.error('[ifood-auth/link] error', {
      traceId,
      message: error?.message,
      stack: error?.stack,
    });

    res.status(500).json({
      error: 'Erro interno no servidor',
      message: error?.message,
      details: error?.stack?.split('\n')[0] || 'Unknown error',
    });
  } finally {
    console.log('[ifood-auth/link] ⇢ end', { traceId, accountId, merchantId, scope });
  }
}
