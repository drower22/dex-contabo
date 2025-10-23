/**
 * @file api/ifood-auth/exchange.ts
 * @description Rota serverless que troca `authorizationCode + authorizationCodeVerifier` por tokens
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

// Rota dedicada para trocar o código de autorização por tokens.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { storeId: bodyStoreId, merchantId: bodyMerchantId, authorizationCode, authorizationCodeVerifier } = req.body;
  if ((!bodyStoreId && !bodyMerchantId) || !authorizationCode || !authorizationCodeVerifier) {
    return res.status(400).json({ error: 'Informe storeId (UUID interno) ou merchantId, além de authorizationCode e authorizationCodeVerifier.' });
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
      return res.status(404).json({ error: 'Conta não encontrada para o storeId/merchantId informado.' });
    }

    const clientId = scope === 'financial'
      ? (process.env.IFOOD_CLIENT_ID_FINANCIAL || process.env.IFOOD_CLIENT_ID)
      : (scope === 'reviews'
          ? (process.env.IFOOD_CLIENT_ID_REVIEWS || process.env.IFOOD_CLIENT_ID)
          : process.env.IFOOD_CLIENT_ID);
    const clientSecret = scope === 'financial'
      ? (process.env.IFOOD_CLIENT_SECRET_FINANCIAL || process.env.IFOOD_CLIENT_SECRET)
      : (scope === 'reviews'
          ? (process.env.IFOOD_CLIENT_SECRET_REVIEWS || process.env.IFOOD_CLIENT_SECRET)
          : process.env.IFOOD_CLIENT_SECRET);

    const response = await fetch(`${IFOOD_BASE_URL}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grantType: 'authorization_code',
        clientId: clientId!,
        clientSecret: clientSecret!,
        authorizationCode,
        authorizationCodeVerifier,
      }),
    });

    const tokenData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Falha ao trocar código por token', details: tokenData });
    }

    // Try to resolve merchantId from token response or fallback to /merchants/me
    let merchantId: string | undefined = tokenData.merchantId
      || tokenData.merchantID
      || tokenData.merchant_id
      || tokenData?.merchant?.id;

    if (!merchantId) {
      try {
        const meResp = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
          headers: { Authorization: `Bearer ${tokenData.accessToken}` },
        } as any);
        if (meResp.ok) {
          const me = await meResp.json();
          merchantId = me?.id || me?.merchantId || me?.merchantID;
        }
      } catch {}
    }
    // Fallback adicional: extrair do JWT (claim merchant_scope)
    if (!merchantId && tokenData?.accessToken) {
      try {
        const [, payloadB64] = String(tokenData.accessToken).split('.');
        const json = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
        const scopeArr: string[] = json?.merchant_scope || json?.merchantScope || [];
        if (Array.isArray(scopeArr) && scopeArr.length) {
          const first = scopeArr[0];
          const candidate = String(first).split(':')[0];
          if (candidate && candidate.length > 0) merchantId = candidate;
        }
      } catch {}
    }

    await supabase
      .from('ifood_store_auth')
      .upsert({
        account_id: resolvedAccountId,
        scope: scope || 'reviews',
        ifood_merchant_id: merchantId || null,
        access_token: await encryptToB64(tokenData.accessToken),
        refresh_token: await encryptToB64(tokenData.refreshToken),
        expires_at: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
        status: 'connected',
      }, { onConflict: 'account_id,scope' });

    // Após salvar os tokens, atualiza a tabela 'accounts' com o merchantId correto
    const finalMerchantId = merchantId || existingMerchantId;
    if (finalMerchantId) {
      await supabase
        .from('accounts')
        .update({
          ifood_merchant_id: merchantId,
        })
        .eq('id', resolvedAccountId);
    }

    res.status(200).json({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expires_in: tokenData.expiresIn,
    });

  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno no servidor', message: e.message });
  }
}
