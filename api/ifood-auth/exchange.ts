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
import { encryptToB64 } from '../_shared/crypto';
import { withCors } from '../_shared/cors';
import { buildIFoodUrl, withIFoodProxy } from '../_shared/proxy';
import axios from 'axios';

// Rota dedicada para trocar o código de autorização por tokens.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

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
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} or SECRET not configured`
      });
      return;
    }

    console.log('[ifood-auth/exchange] 🔑 Using credentials:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      scope
    });

    const url = buildIFoodUrl('/authentication/v1.0/oauth/token');
    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId!,
      client_secret: clientSecret!,
      authorization_code: authorizationCode,
      authorization_code_verifier: authorizationCodeVerifier,
    });

    let tokenData: any;
    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          'Accept-Encoding': 'identity',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'json',
      });
      tokenData = response.data;
    } catch (error: any) { 
      if (axios.isAxiosError(error)) {
        console.error('[ifood-auth/exchange] ❌ Axios error calling iFood API', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
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

    // Remapeia campos para consistência (iFood retorna camelCase)
    tokenData.accessToken = tokenData.accessToken || tokenData.access_token;
    tokenData.refreshToken = tokenData.refreshToken || tokenData.refresh_token;
    tokenData.expiresIn = tokenData.expiresIn || tokenData.expires_in;

    console.log('[ifood-auth/exchange] 📥 iFood response:', {
      hasAccessToken: !!tokenData.accessToken,
      hasRefreshToken: !!tokenData.refreshToken,
      hasExpiresIn: !!tokenData.expiresIn,
      merchantIdFromResponse: tokenData.merchantId || tokenData.merchantID || tokenData.merchant_id || null
    });

    // Try to resolve merchantId from token response or fallback to /merchants/me
    let merchantId: string | undefined = tokenData.merchantId
      || tokenData.merchantID
      || tokenData.merchant_id
      || tokenData?.merchant?.id;

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

    console.log('[ifood-auth/exchange] 🏪 Final merchantId:', merchantId);

    // Encrypt tokens
    console.log('[ifood-auth/exchange] 🔐 Encrypting tokens...');
    const encryptedAccessToken = await encryptToB64(tokenData.accessToken);
    const encryptedRefreshToken = await encryptToB64(tokenData.refreshToken);
    console.log('[ifood-auth/exchange] ✅ Tokens encrypted:', {
      accessTokenLength: encryptedAccessToken.length,
      refreshTokenLength: encryptedRefreshToken.length
    });

    // Prepare upsert data
    const upsertData = {
      account_id: resolvedAccountId,
      scope: scope || 'reviews',
      ifood_merchant_id: merchantId || null,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
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

    // Após salvar os tokens, atualiza a tabela 'accounts' com o merchantId correto
    const finalMerchantId = merchantId || existingMerchantId;
    if (finalMerchantId) {
      console.log('[ifood-auth/exchange] 📝 Updating accounts table with merchantId:', finalMerchantId);
      const { error: updateError } = await supabase
        .from('accounts')
        .update({
          ifood_merchant_id: merchantId,
        })
        .eq('id', resolvedAccountId);

      if (updateError) {
        console.error('[ifood-auth/exchange] ⚠️ Failed to update accounts:', updateError);
      } else {
        console.log('[ifood-auth/exchange] ✅ Accounts table updated');
      }
    }

    console.log('[ifood-auth/exchange] 🎉 Exchange completed successfully');

    res.status(200).json({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expires_in: tokenData.expiresIn,
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
