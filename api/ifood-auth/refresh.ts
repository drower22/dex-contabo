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
import axios from 'axios';
import { withCors } from '../_shared/cors';
import { decryptFromB64, encryptToB64 } from '../_shared/crypto';

// Rota dedicada para refresh de token, garantindo que o método POST seja aceito.

// 🔍 Validação das variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('[ifood-auth/refresh] 🔧 Environment check:', {
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

const refreshHandler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { storeId } = req.body; // pode ser ifood_merchant_id (padrão) OU accounts.id (UUID)
  if (!storeId) {
    console.warn('[ifood-auth/refresh] Missing storeId in request body', { body: req.body, scopeParam });
    res.status(400).json({ error: 'storeId (merchant_id) é obrigatório' });
    return;
  }

  const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[ifood-auth/refresh] ⇢ start', { traceId, storeId, scopeParam, scope });

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
      res.status(404).json({ error: 'storeId não mapeia para nenhuma conta (merchant_id ou accounts.id)' });
      return;
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
      console.warn('[ifood-auth/refresh] No auth data found', { traceId, internalAccountId, wantedScope });
      res.status(404).json({ error: 'not_found', message: 'Refresh token não encontrado para a loja (verifique se o vínculo foi concluído)' });
      return;
    }

    // 2.a. Se o access_token atual ainda está válido por >120s, reutilize para evitar rate limit
    try {
      const expiresAt = authData?.expires_at ? new Date(authData.expires_at) : null;
      const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
      if (expiresAt && remainingMs > 120_000 && authData?.access_token) {
        const currentAccess = await decryptFromB64(authData.access_token);
        console.log('[ifood-auth/refresh] Returning cached token', { traceId, internalAccountId, remainingMs, wantedScope });
        res.status(200).json({
          access_token: currentAccess,
          refresh_token: await decryptFromB64(authData.refresh_token),
          expires_in: Math.floor(remainingMs / 1000),
        });
        return;
      }
    } catch {}

    if (!authData.refresh_token) {
      console.warn('[ifood-auth/refresh] Empty refresh token', { traceId, internalAccountId, wantedScope });
      res.status(404).json({ error: 'not_found', message: 'Refresh token vazio. Refaça o vínculo.' });
      return;
    }

    const refreshToken = await decryptFromB64(authData.refresh_token);

    // Usar apenas variáveis específicas por scope (sem fallback genérico)
    const clientId = scope === 'financial'
      ? process.env.IFOOD_CLIENT_ID_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_ID_REVIEWS
        : undefined;

    if (!clientId) {
      res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} not configured`
      });
      return;
    }

    const targetScope = scope || wantedScope;

    let tokenData: any;
    try {
      console.log('[ifood-auth/refresh] Calling iFood OAuth', {
        traceId,
        scope,
        wantedScope,
        internalAccountId,
      });

      const directUrl = `${IFOOD_BASE_URL}/authentication/v1.0/oauth/token`;
      const proxyBase = process.env.IFOOD_PROXY_BASE?.trim();
      const proxyKey = process.env.IFOOD_PROXY_KEY?.trim();

      const url = proxyBase
        ? `${proxyBase}?path=${encodeURIComponent('/authentication/v1.0/oauth/token')}`
        : directUrl;

      const requestBody = new URLSearchParams({
        grant_type: 'refresh_token',
        clientId: clientId!,
        refresh_token: refreshToken,
        scope: targetScope,
      });
      const requestBodyString = requestBody.toString();

      const headers: any = {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      if (proxyBase && proxyKey) {
        headers['X-Shared-Key'] = proxyKey;
      }

      const { data } = await axios.post(url, requestBodyString, {
        headers,
        responseType: 'json',
      });
      tokenData = data;

      console.log('[ifood-auth/refresh] OAuth request successful', {
        traceId,
        keys: tokenData ? Object.keys(tokenData) : null,
        bodyLength: requestBodyString.length,
      });
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error('[ifood-auth/refresh] Axios error calling OAuth', {
          traceId,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        res.status(error.response?.status || 500).json({ 
          error: 'Falha ao renovar token com iFood', 
          details: error.response?.data 
        });
        return;
      } else {
        console.error('[ifood-auth/refresh] Generic error calling OAuth', {
          traceId,
          error: error?.message,
          stack: error?.stack,
        });
        throw error;
      }
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

    console.log('[ifood-auth/refresh] Token refreshed successfully', {
      traceId,
      internalAccountId,
      wantedScope,
      expiresIn: tokenData.expiresIn,
    });

    res.status(200).json({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expires_in: tokenData.expiresIn,
    });
    return;

  } catch (e: any) {
    console.error('[ifood-auth/refresh] Error:', {
      traceId,
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
    return;
  } finally {
    console.log('[ifood-auth/refresh] ⇢ end', { traceId, storeId, scope });
  }
}

export default withCors(refreshHandler);
