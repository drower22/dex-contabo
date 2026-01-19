/**
 * @file dex-contabo/api/ifood/reviews.ts
 * @description Handler para listar avaliações do iFood (Contabo deployment)
 * 
 * Versão do reviews.ts para deployment no Contabo.
 * Retorna lista paginada de avaliações com suporte a filtros.
 * 
 * FUNCIONALIDADE:
 * - GET: Listar avaliações com paginação
 * - Fallback entre 4 URLs candidatas
 * 
 * @example
 * GET /api/ifood/reviews?merchantId=abc123&rating=5&page=1&size=20
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

    // Normalize query params for iFood Review API v2.0
    // - UI sends: page, size, periodDays
    // - iFood expects: page, pageSize, dateFrom, dateTo, sort, sortBy
    const inboundQuery = Object.fromEntries(url.searchParams.entries());

    // size -> pageSize
    const size = url.searchParams.get('size');
    const pageSize = url.searchParams.get('pageSize');
    if (size && !pageSize) url.searchParams.set('pageSize', size);
    if (size) url.searchParams.delete('size');

    // periodDays -> dateFrom/dateTo (UTC)
    const periodDaysRaw = url.searchParams.get('periodDays');
    if (periodDaysRaw) {
      const days = Number(periodDaysRaw);
      if (!Number.isNaN(days) && days > 0) {
        const dateTo = new Date();
        const dateFrom = new Date(dateTo.getTime() - days * 24 * 60 * 60 * 1000);
        url.searchParams.set('dateFrom', dateFrom.toISOString());
        url.searchParams.set('dateTo', dateTo.toISOString());
      }
      url.searchParams.delete('periodDays');
    }

    const dateFromRaw = url.searchParams.get('dateFrom');
    const dateToRaw = url.searchParams.get('dateTo');
    if (!dateFromRaw && !dateToRaw) {
      const dateTo = new Date();
      const dateFrom = new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);
      url.searchParams.set('dateFrom', dateFrom.toISOString());
      url.searchParams.set('dateTo', dateTo.toISOString());
    } else if (dateFromRaw && !dateToRaw) {
      url.searchParams.set('dateTo', new Date().toISOString());
    } else if (!dateFromRaw && dateToRaw) {
      const dateTo = new Date(dateToRaw);
      if (!Number.isNaN(dateTo.getTime())) {
        const dateFrom = new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);
        url.searchParams.set('dateFrom', dateFrom.toISOString());
      }
    }

    // Defaults for deterministic ordering
    if (!url.searchParams.get('sort')) url.searchParams.set('sort', 'DESC');
    if (!url.searchParams.get('sortBy')) url.searchParams.set('sortBy', 'CREATED_AT');

    // Remove merchantId da query, fará parte do path
    url.searchParams.delete('merchantId');
    const remainingQuery = url.search;
    console.log('[ifood-reviews] inbound', { traceId, inboundQuery });
    console.log('[ifood-reviews] normalized', { traceId, remainingQuery });

    // Prefer iFood Review API reference path first
    const candidates = [
      `/review/v2.0/merchants/${merchantId}/reviews${remainingQuery}`,
      `/v2/merchants/${merchantId}/reviews${remainingQuery}`,
    ];
    const allCandidates = Array.from(new Set(candidates));

    console.log('[ifood-reviews] trace', { traceId, first: allCandidates[0] });
    console.log('[ifood-reviews] candidates', { traceId, count: allCandidates.length });
    allCandidates.forEach((c, i) => console.log(`[ifood-reviews] cand[${i}]`, { traceId, url: c }));

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

    const proxyUrl = new URL(IFOOD_PROXY_BASE);
    proxyUrl.searchParams.set('path', allCandidates[0]);
    let apiResponse = await fetch(proxyUrl.toString(), {
      ...options,
      headers: {
        ...headers,
        'x-shared-key': IFOOD_PROXY_KEY,
      },
    } as any);
    let responseText = await apiResponse.text();

    // Tenta alternativas para 400/404/405
    if ((apiResponse.status === 404 || apiResponse.status === 400 || apiResponse.status === 405 || apiResponse.status === 401 || apiResponse.status === 403) && allCandidates.length > 1) {
      for (let i = 1; i < allCandidates.length; i++) {
        const alt = allCandidates[i];
        console.warn('[ifood-reviews] fallback', { traceId, from: allCandidates[0], status: apiResponse.status, altIndex: i, alt });
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
        console.log('[ifood-reviews] attempt', { traceId, altIndex: i, status: retry.status });
        if (retry.ok) {
          apiResponse = retry;
          responseText = retryText;
          console.log('[ifood-reviews] success', { traceId, altIndex: i, url: alt });
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
    console.error('[ifood-reviews] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
}
