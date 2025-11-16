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

    // Antes: se o token ainda estivesse válido por >120s, o código retornava o token em cache.
    // Para o fluxo de conciliação on-demand, queremos forçar uma chamada real ao iFood
    // em toda requisição de refresh, para garantir que o Supabase seja atualizado.

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
        // Conforme docs iFood: grantType=refresh_token + clientSecret em camelCase
        grantType: 'refresh_token',
        clientId: clientId!,
        clientSecret: clientSecret!,
        refreshToken,
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
        const status = error.response?.status;
        const data = error.response?.data as any;
        console.error('[ifood-auth/refresh] Axios error calling OAuth', {
          traceId,
          status,
          data,
          message: error.message,
        });

        // Tratar caso específico: refresh token inválido no iFood
        const msg = data?.error?.message || data?.message || '';
        if (status === 401 && typeof msg === 'string' && msg.includes('Invalid refresh token')) {
          try {
            await supabase
              .from('ifood_store_auth')
              .update({
                access_token: null,
                expires_at: null,
                status: 'pending',
              })
              .eq('account_id', internalAccountId)
              .eq('scope', wantedScope);
          } catch (dbErr: any) {
            console.error('[ifood-auth/refresh] Failed to mark token as pending after invalid refresh', {
              traceId,
              internalAccountId,
              wantedScope,
              error: dbErr?.message,
            });
          }

          res.status(401).json({
            error: 'refresh_invalid',
            message: 'Refresh token inválido no iFood. É necessário refazer o vínculo (Gerar LinkCode + autorizar + Trocar Código).',
            details: data,
            traceId,
          });
          return;
        }

        res.status(status || 500).json({
          error: 'Falha ao renovar token com iFood',
          details: data,
          traceId,
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

    // Normalizar campos retornados (camelCase vs snake_case)
    tokenData.accessToken = tokenData.accessToken || tokenData.access_token;
    tokenData.refreshToken = tokenData.refreshToken || tokenData.refresh_token;
    tokenData.expiresIn = tokenData.expiresIn || tokenData.expires_in;

    console.log('[ifood-auth/refresh] 📥 Raw tokenData:', tokenData);

    const expiresInSecondsRaw = Number(tokenData.expiresIn ?? 0);
    const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0
      ? expiresInSecondsRaw
      : 21600; // fallback de 6h

    const expiresAtIso = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    await supabase
      .from('ifood_store_auth')
      .update({
        access_token: await encryptToB64(tokenData.accessToken),
        refresh_token: await encryptToB64(tokenData.refreshToken),
        expires_at: expiresAtIso,
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
