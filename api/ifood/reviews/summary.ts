/**
 * @file dex-contabo/api/ifood/reviews/summary.ts
 * @description Handler para resumo estatístico de avaliações (Contabo deployment)
 * 
 * Versão do summary.ts para deployment no Contabo.
 * Retorna métricas agregadas sobre avaliações de um merchant.
 * 
 * FUNCIONALIDADE:
 * - GET: Obter resumo estatístico (nota média, distribuição, taxa de resposta)
 * - Fallback entre múltiplas URLs
 * 
 * @example
 * GET /api/ifood/reviews/summary?merchantId=abc123
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

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
    // Auth header: aceita x-ifood-token ou Authorization: Bearer
    const tokenHeader = (req.headers['x-ifood-token'] || req.headers['authorization'] || '') as string;
    const token = tokenHeader?.toLowerCase().startsWith('bearer ')
      ? tokenHeader.slice(7)
      : tokenHeader;
    if (!token) return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });

    const url = new URL(req.url || '/', 'https://local');
    const merchantId = (url.searchParams.get('merchantId') || '').trim();
    if (!merchantId) return res.status(400).json({ error: 'O parâmetro merchantId é obrigatório.', traceId });

    // Remove merchantId da query, fará parte do path
    url.searchParams.delete('merchantId');
    const remainingQuery = url.search;

    // Candidatos para summary
    const candidates = [
      `${IFOOD_BASE_URL}/v2/merchants/${merchantId}/reviews/summary${remainingQuery}`,
      `${IFOOD_BASE_URL}/v2/merchants/${merchantId}/summary${remainingQuery}`,
      `${IFOOD_BASE_URL}/review/v2.0/merchants/${merchantId}/reviews/summary${remainingQuery}`,
      `${IFOOD_BASE_URL}/review/v2.0/merchants/${merchantId}/summary${remainingQuery}`,
    ];

    console.log('[ifood-reviews-summary] trace', { traceId, first: candidates[0] });
    console.log('[ifood-reviews-summary] candidates', { traceId, count: candidates.length });
    candidates.forEach((c, i) => console.log(`[ifood-reviews-summary] cand[${i}]`, { traceId, url: c }));

    const method = req.method || 'GET';
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

    let apiResponse = await fetch(candidates[0], options as any);
    let responseText = await apiResponse.text();

    // Tenta alternativas para 400/404/405
    if ((apiResponse.status === 404 || apiResponse.status === 400 || apiResponse.status === 405) && candidates.length > 1) {
      for (let i = 1; i < candidates.length; i++) {
        const alt = candidates[i];
        console.warn('[ifood-reviews-summary] fallback', { traceId, from: candidates[0], status: apiResponse.status, altIndex: i, alt });
        const retry = await fetch(alt, options as any);
        const retryText = await retry.text();
        console.log('[ifood-reviews-summary] attempt', { traceId, altIndex: i, status: retry.status });
        if (retry.ok || (retry.status !== 404 && retry.status !== 400)) {
          apiResponse = retry;
          responseText = retryText;
          console.log('[ifood-reviews-summary] success', { traceId, altIndex: i, url: alt });
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
    console.error('[ifood-reviews-summary] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
}
