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

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

const IFOOD_PROXY_BASE = (process.env.IFOOD_PROXY_BASE || '').trim();
const IFOOD_PROXY_KEY = (process.env.IFOOD_PROXY_KEY || '').trim();

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

    const url = new URL(req.url || '/', 'https://local');
    const merchantId = (url.searchParams.get('merchantId') || '').trim();
    if (!merchantId) return res.status(400).json({ error: 'O parâmetro merchantId é obrigatório.', traceId });

    const reviewId = req.query.reviewId as string;
    if (!reviewId) return res.status(400).json({ error: 'reviewId é obrigatório.', traceId });

    // Remove merchantId da query, fará parte do path
    url.searchParams.delete('merchantId');
    const remainingQuery = url.search;

    // Candidatos para POST de resposta
    const candidates = [
      `/v2/merchants/${merchantId}/reviews/${reviewId}/answers${remainingQuery}`,
      `/v2/merchants/${merchantId}/reviews/${reviewId}/reply${remainingQuery}`,
      `/review/v2.0/merchants/${merchantId}/reviews/${reviewId}/answers${remainingQuery}`,
      `/review/v2.0/merchants/${merchantId}/reviews/${reviewId}/reply${remainingQuery}`,
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
