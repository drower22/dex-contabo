/**
 * @file dex-contabo/api/ifood-auth/exchange.ts
 * @description Troca authorizationCode por tokens (Contabo deployment)
 * 
 * Versão do exchange.ts para deployment no Contabo.
 * Troca `authorizationCode + authorizationCodeVerifier` por tokens
 * (access/refresh) no fluxo de autenticação distribuída do iFood.
 *
 * Separação de clientes (dois apps homologados):
 * - Utilize o par `IFOOD_CLIENT_ID`/`IFOOD_CLIENT_SECRET` correspondente ao escopo desejado.
 *   Por exemplo, `merchant+reviews` para endpoints de avaliações e `merchant+financial` para liquidações.
 * - Em ambientes com 2 apps, considere duplicar esta rota por escopo, ou comutar o client por variável/env.
 *
 * Persistência:
 * - Salva tokens criptografados em `ifood_store_auth` amarrados ao `account_id` interno.
 * - Atualiza `accounts.ifood_merchant_id` com o merchantId retornado pelo iFood.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { encryptToB64, decryptFromB64 } from '../_shared/crypto';
import { withCors } from '../_shared/cors';
import { buildIFoodUrl, withIFoodProxy } from '../_shared/proxy';
import axios from 'axios';

// Rota dedicada para trocar o código de autorização por tokens.

// 🔍 Validação das variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('[ifood-auth/exchange] 🔧 Environment check:', {
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
const REDIRECT_URI = process.env.IFOOD_REDIRECT_URI || 'https://portal.ifood.com.br/';

const exchangeHandler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { storeId: bodyStoreId, merchantId: bodyMerchantId, authorizationCode, authorizationCodeVerifier } = req.body;
  
  console.log('[ifood-auth/exchange] 🚀 Starting exchange...', {
    scope,
    bodyStoreId,
    bodyMerchantId,
    hasAuthCode: !!authorizationCode,
    hasVerifier: !!authorizationCodeVerifier
  });

  // 🔍 Log completo dos dados recebidos
  console.log('[ifood-auth/exchange] 📥 Raw request data:', {
    method: req.method,
    query: req.query,
    body: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    }
  });

  if ((!bodyStoreId && !bodyMerchantId) || !authorizationCode || !authorizationCodeVerifier) {
    res.status(400).json({ error: 'Informe storeId (UUID interno) ou merchantId, além de authorizationCode e authorizationCodeVerifier.' });
    return;
  }

  try {
    // Resolve o account_id interno
    let resolvedAccountId: string | null = null;
    let existingMerchantId: string | null = null;
    if (bodyStoreId) {
      const { data: byId } = await supabase
        .from('accounts')
        .select('id, ifood_merchant_id')
        .eq('id', bodyStoreId)
        .maybeSingle();
      if (byId?.id) {
        resolvedAccountId = byId.id as string;
        existingMerchantId = (byId.ifood_merchant_id as string | null) ?? null;
      }
    }

    const merchantLookupCandidate = bodyMerchantId || (!resolvedAccountId ? bodyStoreId : undefined);
    if (!resolvedAccountId && merchantLookupCandidate) {
      const { data: byMerchant } = await supabase
        .from('accounts')
        .select('id, ifood_merchant_id')
        .eq('ifood_merchant_id', merchantLookupCandidate)
        .maybeSingle();
      if (byMerchant?.id) {
        resolvedAccountId = byMerchant.id as string;
        existingMerchantId = (byMerchant.ifood_merchant_id as string | null) ?? null;
      }
    }

    if (!resolvedAccountId) {
      console.error('[ifood-auth/exchange] ❌ Account not found');
      res.status(404).json({ error: 'Conta não encontrada para o storeId/merchantId informado.' });
      return;
    }

    console.log('[ifood-auth/exchange] ✅ Account resolved:', { resolvedAccountId, existingMerchantId });

    // Usar apenas variáveis específicas por scope (sem fallback genérico)
    const clientId = scope === 'financial'
      ? process.env.IFOOD_CLIENT_ID_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_ID_REVIEWS
        : undefined;

    const clientSecret = scope === 'financial'
      ? process.env.IFOOD_CLIENT_SECRET_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_SECRET_REVIEWS
        : undefined;

    if (!clientId || !clientSecret) {
      res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID/SECRET_${scope?.toUpperCase()} not configured`
      });
      return;
    }

    if (!scope) {
      res.status(400).json({ error: 'Scope inválido ou ausente. Utilize ?scope=financial|reviews.' });
      return;
    }

    console.log('[ifood-auth/exchange] 🔑 Using credentials:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      scope
    });

    // 🔍 Log das variáveis antes de montar o request
    console.log('[ifood-auth/exchange] 📋 Variables before request:', {
      authorizationCode: authorizationCode?.substring(0, 10) + '...',
      authorizationCodeVerifier: authorizationCodeVerifier?.substring(0, 10) + '...',
      clientId: clientId?.substring(0, 8) + '...',
      scope,
      REDIRECT_URI,
      IFOOD_BASE_URL: IFOOD_BASE_URL
    });

    const directUrl = buildIFoodUrl('/authentication/v1.0/oauth/token');
    const proxyBase = process.env.IFOOD_PROXY_BASE?.trim();
    const proxyKey = process.env.IFOOD_PROXY_KEY?.trim();

    const url = proxyBase
      ? `${proxyBase}?path=${encodeURIComponent('/authentication/v1.0/oauth/token')}`
      : directUrl;

    const requestBody = new URLSearchParams({
      // Conforme documentação oficial do iFood para /oauth/token (fluxo authorization code + PKCE)
      grantType: 'authorization_code',
      clientId: clientId!,
      clientSecret: clientSecret!,
      authorizationCode: authorizationCode,
      authorizationCodeVerifier: authorizationCodeVerifier,
      redirectUri: REDIRECT_URI,
    });
    const requestBodyString = requestBody.toString();

    // 🔍 Log detalhado do request
    console.log('[ifood-auth/exchange] 📤 Request details:', {
      url,
      method: 'POST',
      headers: {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(proxyBase && proxyKey ? { 'X-Shared-Key': '[MASKED]' } : {}),
      },
      bodyParams: {
        grantType: 'authorization_code',
        clientId: clientId!.substring(0, 8) + '...',
        clientSecret: clientSecret!.substring(0, 4) + '...',
        authorizationCode: authorizationCode?.substring(0, 8) + '...',
        authorizationCodeVerifier: authorizationCodeVerifier?.substring(0, 8) + '...',
        redirectUri: REDIRECT_URI,
      },
      bodyString: requestBodyString
    });

    let tokenData: any;
    try {
      const headers: any = {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      if (proxyBase && proxyKey) {
        headers['X-Shared-Key'] = proxyKey;
      }

      const response = await axios.post(url, requestBodyString, {
        headers,
        responseType: 'json',
      });
      
      console.log('[ifood-auth/exchange] 📥 Axios response details:', {
        status: response.status,
        statusText: response.statusText,
        dataType: typeof response.data,
        dataLength: JSON.stringify(response.data).length,
        dataPreview: JSON.stringify(response.data).substring(0, 200),
        headers: response.headers,
      });
      
      tokenData = response.data;
    } catch (error: any) { 
      if (axios.isAxiosError(error)) {
        console.error('[ifood-auth/exchange] ❌ Axios error calling iFood API', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          requestUrl: url,
          requestBodyString: requestBody.toString(),
        });
        res.status(error.response?.status || 500).json({ 
          error: 'Falha ao trocar código por token',
          details: error.response?.data 
        });
        return;
      } else {
        console.error('[ifood-auth/exchange] ❌ Generic error calling iFood API', {
          error: error?.message,
        });
        throw error;
      }
    }

    console.log('[ifood-auth/exchange] 📥 Raw tokenData (BEFORE normalization):', {
      raw: tokenData,
      type: typeof tokenData,
      keys: Object.keys(tokenData || {}),
      stringified: JSON.stringify(tokenData),
    });

    // Remapeia campos para consistência (iFood retorna camelCase)
    tokenData.accessToken = tokenData.accessToken || tokenData.access_token;
    tokenData.refreshToken = tokenData.refreshToken || tokenData.refresh_token;
    tokenData.expiresIn = tokenData.expiresIn || tokenData.expires_in;

    console.log('[ifood-auth/exchange] 📥 iFood response (normalized):', {
      hasAccessToken: !!tokenData.accessToken,
      hasRefreshToken: !!tokenData.refreshToken,
      hasExpiresIn: !!tokenData.expiresIn,
      expiresIn: tokenData.expiresIn,
      merchantIdFromResponse: tokenData.merchantId || tokenData.merchantID || tokenData.merchant_id || null
    });

    // Buscar merchantId salvo no link primeiro (preserva valor do modal)
    let storedMerchantId: string | null = null;
    try {
      const { data: authRecord } = await supabase
        .from('ifood_store_auth')
        .select('ifood_merchant_id')
        .eq('account_id', resolvedAccountId)
        .eq('scope', scope || 'reviews')
        .maybeSingle();
      storedMerchantId = authRecord?.ifood_merchant_id || null;
      console.log('[ifood-auth/exchange] 🏪 Stored merchantId from link:', storedMerchantId);
    } catch (e: any) {
      console.warn('[ifood-auth/exchange] ⚠️ Failed to fetch stored merchantId:', e.message);
    }

    // Try to resolve merchantId from token response or fallback to /merchants/me
    let merchantId: string | undefined = tokenData.merchantId
      || tokenData.merchantID
      || tokenData.merchant_id
      || tokenData?.merchant?.id
      || storedMerchantId;

    if (!merchantId) {
      console.log('[ifood-auth/exchange] 🔍 Fetching merchantId from /merchants/me...');
      try {
        const meResp = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
          headers: { Authorization: `Bearer ${tokenData.accessToken}` },
        } as any);
        if (meResp.ok) {
          const me: any = await meResp.json();
          merchantId = me?.id || me?.merchantId || me?.merchantID;
          console.log('[ifood-auth/exchange] ✅ MerchantId from /me:', merchantId);
        }
      } catch (e: any) {
        console.error('[ifood-auth/exchange] ⚠️ Failed to fetch /merchants/me:', e.message);
      }
    }
    
    // Fallback adicional: extrair do JWT (claim merchant_scope)
    if (!merchantId && tokenData?.accessToken) {
      console.log('[ifood-auth/exchange] 🔍 Extracting merchantId from JWT...');
      try {
        const [, payloadB64] = String(tokenData.accessToken).split('.');
        const json = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
        const scopeArr: string[] = json?.merchant_scope || json?.merchantScope || [];
        if (Array.isArray(scopeArr) && scopeArr.length) {
          const first = scopeArr[0];
          const candidate = String(first).split(':')[0];
          if (candidate && candidate.length > 0) {
            merchantId = candidate;
            console.log('[ifood-auth/exchange] ✅ MerchantId from JWT:', merchantId);
          }
        }
      } catch (e: any) {
        console.error('[ifood-auth/exchange] ⚠️ Failed to extract from JWT:', e.message);
      }
    }

    console.log('[ifood-auth/exchange] 🏪 Final merchantId resolved:', {
      merchantId,
      storedMerchantId,
      existingMerchantId,
      willUse: merchantId || storedMerchantId || existingMerchantId || 'NULL'
    });

    // Encrypt tokens
    console.log('[ifood-auth/exchange] 🔐 Encrypting tokens...');
    const encryptedAccessToken = await encryptToB64(tokenData.accessToken);
    const encryptedRefreshToken = await encryptToB64(tokenData.refreshToken);
    console.log('[ifood-auth/exchange] ✅ Tokens encrypted:', {
      accessTokenLength: encryptedAccessToken.length,
      refreshTokenLength: encryptedRefreshToken.length
    });

    // Calcular expires_at com segurança
    const expiresInSecondsRaw = Number(tokenData.expiresIn ?? 0);
    const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0
      ? expiresInSecondsRaw
      : 21600; // fallback padrão de 6h (documentação iFood)

    const expiresAtIso = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Prepare upsert data (sem forçar merchantId; ele será consolidado em finalMerchantId abaixo)
    const upsertData = {
      account_id: resolvedAccountId,
      scope: scope || 'reviews',
      ifood_merchant_id: merchantId || storedMerchantId || existingMerchantId || null,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiresAtIso,
      status: 'connected',
    };

    console.log('[ifood-auth/exchange] 💾 Upserting to Supabase...', {
      account_id: upsertData.account_id,
      scope: upsertData.scope,
      ifood_merchant_id: upsertData.ifood_merchant_id,
      status: upsertData.status,
      expires_at: upsertData.expires_at,
      hasAccessToken: !!upsertData.access_token,
      hasRefreshToken: !!upsertData.refresh_token
    });

    const { data: savedData, error: upsertError } = await supabase
      .from('ifood_store_auth')
      .upsert(upsertData, { onConflict: 'account_id,scope' })
      .select();

    if (upsertError) {
      console.error('[ifood-auth/exchange] ❌ Supabase upsert error:', {
        message: upsertError.message,
        details: upsertError.details,
        hint: upsertError.hint,
        code: upsertError.code
      });
      throw new Error(`Failed to save tokens: ${upsertError.message}`);
    }

    console.log('[ifood-auth/exchange] ✅ Upsert successful:', savedData);

    // 🔍 Diagnóstico: ler de volta o refresh_token salvo, descriptografar e comparar
    try {
      const { data: verifyRow } = await supabase
        .from('ifood_store_auth')
        .select('refresh_token')
        .eq('account_id', resolvedAccountId)
        .eq('scope', scope || 'reviews')
        .maybeSingle();

      if (verifyRow?.refresh_token) {
        const decryptedRefresh = await decryptFromB64(verifyRow.refresh_token as string);
        const same = decryptedRefresh === tokenData.refreshToken;
        console.log('[ifood-auth/exchange] 🔍 Crypto verification for refresh_token:', {
          accountId: resolvedAccountId,
          scope,
          originalPreview: String(tokenData.refreshToken).substring(0, 16) + '...',
          decryptedPreview: decryptedRefresh.substring(0, 16) + '...',
          originalLength: String(tokenData.refreshToken).length,
          decryptedLength: decryptedRefresh.length,
          equals: same,
        });
      } else {
        console.warn('[ifood-auth/exchange] ⚠️ Crypto verification skipped: no refresh_token row found after upsert', {
          accountId: resolvedAccountId,
          scope,
        });
      }
    } catch (verifyErr: any) {
      console.error('[ifood-auth/exchange] ⚠️ Crypto verification error:', {
        message: verifyErr?.message,
      });
    }

    // Após salvar os tokens, consolida o merchantId final e garante persistência nas duas tabelas
    const finalMerchantId = merchantId || storedMerchantId || existingMerchantId;
    if (finalMerchantId) {
      console.log('[ifood-auth/exchange] 📝 Updating accounts & ifood_store_auth with merchantId:', finalMerchantId);

      const [{ error: updateAccountsError }, { error: updateAuthError }] = await Promise.all([
        supabase
          .from('accounts')
          .update({ ifood_merchant_id: finalMerchantId })
          .eq('id', resolvedAccountId),
        supabase
          .from('ifood_store_auth')
          .update({ ifood_merchant_id: finalMerchantId })
          .eq('account_id', resolvedAccountId)
          .eq('scope', scope || 'reviews'),
      ]);

      if (updateAccountsError) {
        console.error('[ifood-auth/exchange] ⚠️ Failed to update accounts:', updateAccountsError);
      } else {
        console.log('[ifood-auth/exchange] ✅ Accounts table updated');
      }

      if (updateAuthError) {
        console.error('[ifood-auth/exchange] ⚠️ Failed to update ifood_store_auth with merchantId:', updateAuthError);
      } else {
        console.log('[ifood-auth/exchange] ✅ ifood_store_auth updated with merchantId');
      }
    }

    console.log('[ifood-auth/exchange] 🎉 Exchange completed successfully');

    res.status(200).json({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expires_in: tokenData.expiresIn,
      merchant_id: finalMerchantId,
    });
    return;

  } catch (e: any) {
    console.error('[ifood-auth/exchange] 💥 Fatal error:', {
      message: e.message,
      stack: e.stack
    });
    res.status(500).json({ error: 'Erro interno no servidor', message: e.message });
    return;
  }
}

export default withCors(exchangeHandler);
