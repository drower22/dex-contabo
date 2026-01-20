/**
 * @file dex-contabo/api/ifood/reviews/[reviewId]/answers.ts
 * @description Handler para responder avaliações do iFood (Contabo deployment)
 * 
 * Versão do answers.ts para deployment no Contabo.
 * Permite criar respostas para avaliações de clientes com fallback automático.
 * 
 * FUNCIONALIDADE:
 * - POST: Criar resposta para uma avaliação
 * - Fallback entre múltiplas URLs (v2, review/v2.0, /answers, /reply)
 * 
 * @example
 * POST /api/ifood/reviews/abc123/answers?merchantId=xyz789
 * Body: { "text": "Obrigado pelo feedback!" }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { resolveAccountId } from '../../../_shared/account-resolver';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

const IFOOD_PROXY_BASE = (process.env.IFOOD_PROXY_BASE || '').trim();
const IFOOD_PROXY_KEY = (process.env.IFOOD_PROXY_KEY || '').trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function getSupabaseServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveAccountIdByMerchantId(merchantId: string): Promise<string | null> {
  const m = (merchantId || '').trim();
  if (!m) return null;

  try {
    const resolved = await resolveAccountId(m);
    if (resolved?.id) return String(resolved.id);
  } catch {
    // ignore
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('ifood_store_auth')
    .select('account_id')
    .eq('ifood_merchant_id', m)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  const id = (data as any)?.account_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

async function persistReplyToSupabase(params: {
  reviewId: string;
  merchantId: string;
  replyText: string;
  traceId: string;
}) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    console.warn('[ifood-reviews-answers] supabase not configured for persistence', { traceId: params.traceId });
    return;
  }

  const reviewId = params.reviewId;
  const merchantId = params.merchantId;
  const replyText = (params.replyText || '').trim();
  if (!reviewId || !merchantId || !replyText) return;

  const accountId = await resolveAccountIdByMerchantId(merchantId);
  if (!accountId) {
    console.warn('[ifood-reviews-answers] could not resolve account_id for merchantId', {
      traceId: params.traceId,
      merchantId,
      reviewId,
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const replyObj = { createdAt: nowIso, text: replyText, from: 'merchant' };

  // 1) Normalizada
  const { error: insertError } = await supabase
    .from('ifood_review_replies')
    .insert({
      review_id: reviewId,
      account_id: accountId,
      merchant_id: merchantId,
      text: replyText,
      created_at: nowIso,
    } as any);

  if (insertError) {
    console.warn('[ifood-reviews-answers] insert ifood_review_replies error', {
      traceId: params.traceId,
      reviewId,
      accountId,
      merchantId,
      error: insertError,
    });
  }

  // 2) Best-effort: refletir em ifood_reviews.raw.replies (para UI/view)
  try {
    const { data: current, error: readError } = await supabase
      .from('ifood_reviews')
      .select('raw')
      .eq('review_id', reviewId)
      .maybeSingle();

    if (readError) {
      console.warn('[ifood-reviews-answers] read ifood_reviews.raw error', { traceId: params.traceId, reviewId, error: readError });
      return;
    }

    const raw = (current as any)?.raw ?? {};
    const existing = Array.isArray((raw as any)?.replies) ? (raw as any).replies : [];
    const nextRaw = { ...raw, replies: [replyObj, ...existing] };

    const { error: updateError } = await supabase
      .from('ifood_reviews')
      .update({ raw: nextRaw })
      .eq('review_id', reviewId);

    if (updateError) {
      console.warn('[ifood-reviews-answers] update ifood_reviews.raw error', { traceId: params.traceId, reviewId, error: updateError });
    }
  } catch (e: any) {
    console.warn('[ifood-reviews-answers] persist raw exception', { traceId: params.traceId, reviewId, err: e?.message || String(e) });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', cors['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);
  if (req.method === 'OPTIONS') return res.status(200).send('ok');

  const traceId = Date.now().toString(36);
  res.setHeader('X-Trace-Id', traceId);

  try {
    if (!IFOOD_PROXY_BASE || !IFOOD_PROXY_KEY) {
      return res.status(500).json({
        error: 'ifood_proxy_not_configured',
        details: 'Defina IFOOD_PROXY_BASE e IFOOD_PROXY_KEY no .env do Contabo.',
        traceId,
      });
    }

    // Auth header: aceita x-ifood-token ou Authorization: Bearer
    const tokenHeader = (req.headers['x-ifood-token'] || req.headers['authorization'] || '') as string;
    const token = tokenHeader?.toLowerCase().startsWith('bearer ')
      ? tokenHeader.slice(7)
      : tokenHeader;
    if (!token) return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });

    const rawUrl = ((req as any)?.originalUrl || req.url || '/').toString();
    const url = new URL(rawUrl, 'https://local');
    const merchantId = (url.searchParams.get('merchantId') || '').trim();
    if (!merchantId) return res.status(400).json({ error: 'O parâmetro merchantId é obrigatório.', traceId });

    const reviewId =
      (req.query as any)?.reviewId ||
      (req as any)?.params?.reviewId ||
      url.pathname.match(/\/reviews\/([^/]+)\/answers/i)?.[1] ||
      rawUrl.match(/\/reviews\/([^/?#]+)\/answers/i)?.[1];
    if (!reviewId) {
      console.warn('[ifood-reviews-answers] missing reviewId', {
        traceId,
        rawUrl,
        reqUrl: (req as any)?.url,
        originalUrl: (req as any)?.originalUrl,
        pathname: url.pathname,
        query: (req as any)?.query,
        params: (req as any)?.params,
      });
      return res.status(400).json({ error: 'reviewId é obrigatório.', traceId });
    }

    // Remove merchantId da query, fará parte do path
    url.searchParams.delete('merchantId');
    const remainingQuery = url.search;

    // Review module is exposed under /review/v2.0 on merchant-api host.
    // Keep /v2 as fallback; keep non-prefixed /merchants variants last.
    const candidates = [
      `/review/v2.0/merchants/${merchantId}/reviews/${reviewId}/answers${remainingQuery}`,
      `/v2/merchants/${merchantId}/reviews/${reviewId}/answers${remainingQuery}`,
      `/review/v2.0/merchants/${merchantId}/reviews/${reviewId}/reply${remainingQuery}`,
      `/v2/merchants/${merchantId}/reviews/${reviewId}/reply${remainingQuery}`,
      `/merchants/${merchantId}/reviews/${reviewId}/answers${remainingQuery}`,
      `/merchants/${merchantId}/reviews/${reviewId}/reply${remainingQuery}`,
    ];

    console.log('[ifood-reviews-answers] trace', { traceId, reviewId, first: candidates[0] });
    console.log('[ifood-reviews-answers] candidates', { traceId, count: candidates.length });
    candidates.forEach((c, i) => console.log(`[ifood-reviews-answers] cand[${i}]`, { traceId, url: c }));

    const method = req.method || 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    const homo = (req.headers['x-request-homologation'] || '').toString().trim().toLowerCase();
    if (homo === 'true' || homo === '1') headers['x-request-homologation'] = 'true';

    const options: RequestInit = {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})) : undefined,
    };

    const proxyUrl = new URL(IFOOD_PROXY_BASE);
    proxyUrl.searchParams.set('path', candidates[0]);
    let apiResponse = await fetch(proxyUrl.toString(), {
      ...options,
      headers: {
        ...headers,
        'x-shared-key': IFOOD_PROXY_KEY,
      },
    } as any);
    let responseText = await apiResponse.text();

    if (!apiResponse.ok) {
      console.warn('[ifood-reviews-answers] first attempt non-ok', {
        traceId,
        status: apiResponse.status,
        candidate: candidates[0],
        responsePreview: responseText?.slice?.(0, 500),
      });
    }

    // Tenta alternativas para 400/404/405
    if ((apiResponse.status === 404 || apiResponse.status === 400 || apiResponse.status === 405 || apiResponse.status === 401 || apiResponse.status === 403) && candidates.length > 1) {
      for (let i = 1; i < candidates.length; i++) {
        const alt = candidates[i];
        console.warn('[ifood-reviews-answers] fallback', { traceId, from: candidates[0], status: apiResponse.status, altIndex: i, alt });
        const retryUrl = new URL(IFOOD_PROXY_BASE);
        retryUrl.searchParams.set('path', alt);
        const retry = await fetch(retryUrl.toString(), {
          ...options,
          headers: {
            ...headers,
            'x-shared-key': IFOOD_PROXY_KEY,
          },
        } as any);
        const retryText = await retry.text();
        if (!retry.ok) {
          console.warn('[ifood-reviews-answers] attempt non-ok', {
            traceId,
            altIndex: i,
            status: retry.status,
            candidate: alt,
            responsePreview: retryText?.slice?.(0, 500),
          });
        }
        console.log('[ifood-reviews-answers] attempt', { traceId, altIndex: i, status: retry.status });
        if (retry.ok) {
          apiResponse = retry;
          responseText = retryText;
          console.log('[ifood-reviews-answers] success', { traceId, altIndex: i, url: alt });
          break;
        }
        apiResponse = retry;
        responseText = retryText;
      }
    }

    if (apiResponse.ok && (req.method || '').toUpperCase() === 'POST') {
      try {
        const rawBody = (req as any)?.body;
        const bodyObj = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        const replyText = String(bodyObj?.text ?? '').trim();
        if (replyText) {
          await persistReplyToSupabase({ reviewId: String(reviewId), merchantId, replyText, traceId });
        }
      } catch (e: any) {
        console.warn('[ifood-reviews-answers] persist reply best-effort failed', { traceId, err: e?.message || String(e) });
      }
    }

    res.status(apiResponse.status);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Trace-Id', traceId);
    return res.send(responseText);

  } catch (e: any) {
    console.error('[ifood-reviews-answers] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
}
