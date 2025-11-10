/**
 * @file dex-contabo/api/ifood-auth/refresh.ts
 * @description Renova tokens usando refreshToken (Contabo deployment)
 * 
 * Versão do refresh.ts para deployment no Contabo.
 * Rota serverless para RENOVAR o access_token no fluxo distribuído do iFood usando refresh_token.
 *
 * Como funciona:
 * - Entrada: `storeId` RECEBE o merchant_id do iFood (id da loja no iFood).
 * - Mapeia `merchant_id -> accounts.id` e então busca o refresh_token em `ifood_store_auth.account_id` (id interno).
 * - Envia `grantType=refresh_token` para `/oauth/token` e atualiza os campos criptografados na mesma tabela.
 *
 * Ambientes com 2 apps (reviews x financial):
 * - Esta função usa `IFOOD_CLIENT_ID` e `IFOOD_CLIENT_SECRET` do ambiente onde está publicada.
 * - Caso seu projeto mantenha dois apps, publique duas versões (ou use envs distintos) e direcione cada chamada.
 *
 * Tabelas e campos:
 * - `accounts.ifood_merchant_id` (chave para localizar a conta interna)
 * - `ifood_store_auth.account_id` (id interno da conta), `access_token`, `refresh_token`, `expires_at`
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64, encryptToB64 } from '../_shared/crypto';

// Rota dedicada para refresh de token, garantindo que o método POST seja aceito.

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
  const { storeId } = req.body; // pode ser ifood_merchant_id (padrão) OU accounts.id (UUID)
  if (!storeId) {
    return res.status(400).json({ error: 'storeId (merchant_id) é obrigatório' });
  }

  try {
    // 1. Encontrar a conta. Aceita:
    //    a) storeId = ifood_merchant_id (padrão)
    //    b) storeId = accounts.id (UUID) — fallback
    let internalAccountId: string | null = null;
    {
      const { data: byMerchant } = await supabase
        .from('accounts')
        .select('id')
        .eq('ifood_merchant_id', storeId)
        .maybeSingle();
      if (byMerchant?.id) internalAccountId = byMerchant.id as string;
    }
    if (!internalAccountId) {
      // fallback: tratar storeId como UUID de accounts.id
      const { data: byUuid } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', storeId)
        .maybeSingle();
      if (byUuid?.id) internalAccountId = byUuid.id as string;
    }
    if (!internalAccountId) {
      return res.status(404).json({ error: 'storeId não mapeia para nenhuma conta (merchant_id ou accounts.id)' });
    }

    // 2. Usar o ID interno para buscar o token de atualização
    // 2. Buscar token por escopo, com fallback para o escopo oposto
    const wantedScope = scope || 'reviews';
    let { data: authData } = await supabase
      .from('ifood_store_auth')
      .select('refresh_token, access_token, expires_at')
      .eq('account_id', internalAccountId)
      .eq('scope', wantedScope)
      .maybeSingle();
    if (!authData) {
      const opposite = wantedScope === 'financial' ? 'reviews' : 'financial';
      const { data: fallbackData } = await supabase
        .from('ifood_store_auth')
        .select('refresh_token, access_token, expires_at')
        .eq('account_id', internalAccountId)
        .eq('scope', opposite)
        .maybeSingle();
      authData = fallbackData || undefined as any;
    }
    if (!authData) {
      return res.status(404).json({ error: 'not_found', message: 'Refresh token não encontrado para a loja (verifique se o vínculo foi concluído)' });
    }

    // 2.a. Se o access_token atual ainda está válido por >120s, reutilize para evitar rate limit
    try {
      const expiresAt = authData?.expires_at ? new Date(authData.expires_at) : null;
      const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
      if (expiresAt && remainingMs > 120_000 && authData?.access_token) {
        const currentAccess = await decryptFromB64(authData.access_token);
        return res.status(200).json({
          access_token: currentAccess,
          refresh_token: await decryptFromB64(authData.refresh_token),
          expires_in: Math.floor(remainingMs / 1000),
        });
      }
    } catch {}

    const refreshToken = await decryptFromB64(authData.refresh_token);

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
        grant_type: 'refresh_token',
        client_id: clientId!,
        client_secret: clientSecret!,
        refresh_token: refreshToken,
      }),
    });

    const tokenData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Falha ao renovar token com iFood', details: tokenData });
    }

    await supabase
      .from('ifood_store_auth')
      .update({
        access_token: await encryptToB64(tokenData.accessToken),
        refresh_token: await encryptToB64(tokenData.refreshToken),
        expires_at: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
        status: 'connected',
      })
      .eq('account_id', internalAccountId)
      .eq('scope', wantedScope);

    res.status(200).json({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expires_in: tokenData.expiresIn,
    });

  } catch (e: any) {
    console.error('[ifood-auth/refresh] Error:', {
      error: e.message,
      stack: e.stack,
      storeId,
      scope,
      name: e.name
    });
    res.status(500).json({ 
      error: 'Erro interno no servidor', 
      message: e.message,
      details: e.stack?.split('\n')[0] || e.toString()
    });
  }
}
