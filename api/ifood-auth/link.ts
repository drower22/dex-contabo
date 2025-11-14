/**
 * @file dex-contabo/api/ifood-auth/link.ts
 * @description Gera userCode para vínculo OAuth (Contabo deployment) - COM LOGS DE DEBUG
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { withCors } from '../_shared/cors';
import { buildIFoodUrl, withIFoodProxy } from '../_shared/proxy';
import axios from 'axios';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

// 🔍 Validação das variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('[ifood-auth/link] 🔧 Environment check:', {
  hasSupabaseUrl: !!SUPABASE_URL,
  hasSupabaseKey: !!SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrlLength: SUPABASE_URL?.length || 0,
  supabaseKeyLength: SUPABASE_SERVICE_ROLE_KEY?.length || 0
});

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(`Missing Supabase credentials: URL=${!!SUPABASE_URL}, KEY=${!!SUPABASE_SERVICE_ROLE_KEY}`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const linkHandler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  console.log('\n========== [LINK] INÍCIO DA REQUISIÇÃO ==========');
  console.log('[LINK] 📥 Method:', req.method);
  console.log('[LINK] 📥 URL:', req.url);
  console.log('[LINK] 📥 Query:', JSON.stringify(req.query, null, 2));
  console.log('[LINK] 📥 Body:', JSON.stringify(req.body, null, 2));
  

  if (req.method !== 'POST') {
    console.log('[LINK] ❌ Method not allowed:', req.method);
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { accountId, merchantId } = req.body;
  const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[ifood-auth/link] ⇢ start', { 
    traceId,
    accountId,
    merchantId,
    scopeParam,
    scope
  });

  // ✅ Fluxo correto: só precisa do accountId (UUID interno)
  if (!accountId) {
    console.log('[ifood-auth/link] ❌ Missing accountId');
    res.status(400).json({ error: 'accountId (UUID interno) é obrigatório' });
    return;
  }

  if (!scope) {
    console.log('[ifood-auth/link] ❌ Invalid scope');
    res.status(400).json({ error: 'Scope inválido. Use ?scope=financial ou ?scope=reviews' });
    return;
  }

  try {
    // ✅ Não consulta banco - apenas valida se é UUID válido
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(accountId)) {
      console.log('[ifood-auth/link] ❌ Invalid accountId format');
      res.status(400).json({ error: 'accountId deve ser um UUID válido' });
      return;
    }

    console.log('[ifood-auth/link] ✅ AccountId válido, gerando userCode...', { accountId, scope });

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
      res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} not configured`
      });
      return;
    }

    const requestBody = new URLSearchParams({
      clientId: clientId,  // ✅ CORRIGIDO: camelCase
    });

    if (merchantId?.trim()) {
      requestBody.append('merchantId', merchantId.trim());
    }

    console.log('[ifood-auth/link] 📤 Sending request to iFood API:', {
      url: `${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyParams: { clientId: `${clientId.substring(0, 8)}...` }
    });

    // 🔧 Usar proxy se configurado, senão URL direta
    const directUrl = buildIFoodUrl('/authentication/v1.0/oauth/userCode');
    const proxyBase = process.env.IFOOD_PROXY_BASE?.trim();
    const proxyKey = process.env.IFOOD_PROXY_KEY?.trim();
    
    // ✅ CORREÇÃO: Proxy Vercel espera ?path= como parâmetro
    const url = proxyBase ? `${proxyBase}?path=${encodeURIComponent('/authentication/v1.0/oauth/userCode')}` : directUrl;
    
    console.log('[ifood-auth/link] 🌐 Request config:', {
      useProxy: !!proxyBase,
      url: url.substring(0, 50) + '...',
      hasProxyKey: !!proxyKey
    });

    let data: any;
    try {
      const headers: any = {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/x-www-form-urlencoded'
      };
      
      // Adicionar chave do proxy se usando proxy
      if (proxyBase && proxyKey) {
        headers['X-Shared-Key'] = proxyKey;
      }

      const response = await axios.post<string>(url, requestBody, {
        headers,
        responseType: 'text',
        transformResponse: [(value) => value],
        validateStatus: () => true,
      });

      const rawBody = response.data ?? '';
      let parsedBody: any = rawBody;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : rawBody;
      } catch {
        // Mantém como texto
      }

      console.log('[ifood-auth/link] 📥 iFood API response:', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        rawBody,
        parsedType: typeof parsedBody,
      });

      if (response.status >= 400) {
        console.warn('[ifood-auth/link] ❌ iFood API returned non-2xx', { traceId, status: response.status, rawBody });
        res.status(response.status).json({
          error: 'Falha ao solicitar código de autorização do iFood',
          details: parsedBody || rawBody,
        });
        return;
      }

      data = parsedBody;
      console.log('[ifood-auth/link] ✅ iFood API response body:', JSON.stringify(data, null, 2));
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error('[ifood-auth/link] ❌ Axios error calling iFood API', {
          traceId,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        res.status(error.response?.status || 500).json({ 
          error: 'Falha ao solicitar código de autorização do iFood',
          details: error.response?.data 
        });
        return;
      } else {
        console.error('[ifood-auth/link] ❌ Generic error calling iFood API', {
          traceId,
          error: error?.message,
        });
        throw error;
      }
    }

    // ✅ Salvar apenas link_code e verifier (sem merchantId ainda)
    const { error: saveError } = await supabase
      .from('ifood_store_auth')
      .upsert({
        account_id: accountId,
        scope: scope,
        link_code: data.userCode,
        verifier: data.authorizationCodeVerifier,
        status: 'pending',
      }, { onConflict: 'account_id,scope' });

    if (saveError) {
      console.error('[ifood-auth/link] ❌ Error saving to database', { traceId, saveError });
      res.status(500).json({ error: 'Falha ao salvar no banco de dados', details: saveError.message });
      return;
    }

    console.log('[ifood-auth/link] ✅ Link stored successfully', { traceId, accountId, scope });

    res.status(200).json({
      ...data,
      account_id: accountId,
    });
    return;
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
    return;
  } finally {
    console.log('[ifood-auth/link] ⇢ end', { traceId, accountId, scope });
  }
}

export default withCors(linkHandler);
