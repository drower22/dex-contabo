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

  const logConciliation = async (
    level: 'debug' | 'info' | 'warn' | 'error',
    step: string,
    message: string,
    metadata?: any,
  ) => {
    try {
      await supabase.from('ifood_conciliation_logs').insert({
        run_id: null,
        trace_id: traceId,
        level,
        step,
        message,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
      });
    } catch (err: any) {
      console.error('[ifood-auth/refresh] failed_to_log_conciliation', {
        traceId,
        step,
        error: err?.message,
      });
    }
  };

  try {
    // 1. Encontrar a conta. Aceita:
    //    a) storeId = ifood_merchant_id (padrão)
    //    b) storeId = accounts.id (UUID) — fallback
    let internalAccountId: string | null = null;
    let merchantIdForLogs: string | null = null;
    {
      const { data: byMerchant } = await supabase
        .from('accounts')
        .select('id, ifood_merchant_id')
        .eq('ifood_merchant_id', storeId)
        .maybeSingle();
      if (byMerchant?.id) {
        internalAccountId = byMerchant.id as string;
        merchantIdForLogs = (byMerchant.ifood_merchant_id as string | null) ?? null;
      }
    }
    if (!internalAccountId) {
      // fallback: tratar storeId como UUID de accounts.id
      const { data: byUuid } = await supabase
        .from('accounts')
        .select('id, ifood_merchant_id')
        .eq('id', storeId)
        .maybeSingle();
      if (byUuid?.id) {
        internalAccountId = byUuid.id as string;
        merchantIdForLogs = (byUuid.ifood_merchant_id as string | null) ?? merchantIdForLogs;
      }
    }
    if (!internalAccountId) {
      await logConciliation('error', 'refresh', 'storeId não mapeia para nenhuma conta', { storeId, scope, scopeParam });
      res.status(404).json({ error: 'storeId não mapeia para nenhuma conta (merchant_id ou accounts.id)' });
      return;
    }

    // 2. Usar o ID interno para buscar o token de atualização
    // Para o backend financeiro, preferimos SEMPRE o escopo 'financial'
    const wantedScope = scope || 'financial';
    const { data: authData } = await supabase
      .from('ifood_store_auth')
      .select('refresh_token, access_token, expires_at')
      .eq('account_id', internalAccountId)
      .eq('scope', wantedScope)
      .maybeSingle();
    if (!authData) {
      console.warn('[ifood-auth/refresh] No auth data found', { traceId, internalAccountId, wantedScope });
      await logConciliation('error', 'refresh', 'Refresh token não encontrado para a loja', {
        internalAccountId,
        wantedScope,
        merchantId: merchantIdForLogs,
      });
      res.status(404).json({ error: 'not_found', message: 'Refresh token não encontrado para a loja (verifique se o vínculo foi concluído)' });
      return;
    }

    // Antes: se o token ainda estivesse válido por >120s, o código retornava o token em cache.
    // Para o fluxo de conciliação on-demand, queremos forçar uma chamada real ao iFood
    // em toda requisição de refresh, para garantir que o Supabase seja atualizado.

    if (!authData.refresh_token) {
      console.warn('[ifood-auth/refresh] Empty refresh token', { traceId, internalAccountId, wantedScope });
      await logConciliation('error', 'refresh', 'Refresh token vazio. Refaça o vínculo.', {
        internalAccountId,
        wantedScope,
        merchantId: merchantIdForLogs,
      });
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
          await logConciliation('error', 'refresh', 'Invalid refresh token no iFood', {
            internalAccountId,
            wantedScope,
            merchantId: merchantIdForLogs,
            status,
            data,
          });

          // Nessa situação específica, NÃO vamos apagar o token salvo no Supabase.
          // Em vez disso, tentamos devolver o access_token atual (se existir e for descriptografável)
          // para que o frontend (FinanceTestPage) ainda possa visualizar/usar o token.
          let currentAccess: string | null = null;
          try {
            // authData ainda está disponível do escopo superior
            if (authData?.access_token) {
              currentAccess = await decryptFromB64(authData.access_token as string);
            }
          } catch (decErr: any) {
            console.error('[ifood-auth/refresh] Failed to decrypt existing access_token after invalid refresh', {
              traceId,
              internalAccountId,
              wantedScope,
              error: decErr?.message,
            });
          }

          // Se conseguirmos descriptografar o token atual, retornamos 200 com ele,
          // sinalizando que o refresh falhou mas o token existente ainda está disponível.
          if (currentAccess) {
            res.status(200).json({
              access_token: currentAccess,
              refresh_token: refreshToken,
              expires_in: 0,
              error: 'refresh_invalid',
              message: 'Refresh token inválido no iFood. Usando access_token atual salvo.',
              traceId,
            });
            return;
          }

          // Se não houver access_token utilizável, mantemos o comportamento de erro 401.
          res.status(401).json({
            error: 'refresh_invalid',
            message: 'Refresh token inválido no iFood e nenhum access_token atual pôde ser utilizado.',
            details: data,
            traceId,
          });
          return;
        }

        await logConciliation('error', 'refresh', 'Falha ao renovar token com iFood', {
          internalAccountId,
          wantedScope,
          merchantId: merchantIdForLogs,
          status: status || 500,
          data,
        });

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

    console.log('[ifood-auth/refresh] 📥 iFood response (normalized):', {
      hasAccessToken: !!tokenData.accessToken,
      hasRefreshToken: !!tokenData.refreshToken,
      hasExpiresIn: !!tokenData.expiresIn,
      expiresIn: tokenData.expiresIn,
    });

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

    await logConciliation('info', 'refresh', 'Token refreshed successfully', {
      internalAccountId,
      wantedScope,
      merchantId: merchantIdForLogs,
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
