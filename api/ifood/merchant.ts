/**
 * @file dex-contabo/api/ifood/merchant.ts
 * @description Proxy para API de Merchants do iFood (Contabo deployment)
 * 
 * Versão do merchant.ts para deployment no Contabo.
 * Faz proxy de requisições relacionadas a merchants para a API oficial do iFood.
 * 
 * ENDPOINTS SUPORTADOS:
 * - GET /api/ifood/merchant?merchantId=xxx (detalhes básicos)
 * - GET /api/ifood/merchant?merchantId=xxx&endpoint=status
 * - GET /api/ifood/merchant?merchantId=xxx&endpoint=availability
 * - GET /api/ifood/merchant?merchantId=xxx&endpoint=opening-hours
 * - GET /api/ifood/merchant?merchantId=xxx&endpoint=interruptions
 * 
 * AUTENTICAÇÃO:
 * - x-ifood-token ou authorization: Bearer {token}
 * 
 * @example
 * GET /api/ifood/merchant?merchantId=abc123&endpoint=status
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

/**
 * Handler principal do proxy de merchants.
 * @param req - Request com merchantId e endpoint
 * @param res - Response do Vercel
 */
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
    // Auth header
    const tokenHeader = (req.headers['x-ifood-token'] || req.headers['authorization'] || '') as string;
    const token = tokenHeader?.toLowerCase().startsWith('bearer ')
      ? tokenHeader.slice(7)
      : tokenHeader;
    if (!token) return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });

    const { merchantId, endpoint, path } = req.query;
    const originalUrl = new URL(req.url || '/', 'https://local');
    
    if (!merchantId || typeof merchantId !== 'string') {
      return res.status(400).json({ error: 'merchantId é obrigatório', traceId });
    }

    const endpointStr = typeof endpoint === 'string' ? endpoint : '';
    const extraPathRaw = typeof path === 'string' ? path.trim() : '';
    const extraPath = extraPathRaw
      ? extraPathRaw.startsWith('/')
        ? extraPathRaw
        : `/${extraPathRaw}`
      : '';

    const searchParams = new URLSearchParams(originalUrl.searchParams);
    searchParams.delete('merchantId');
    searchParams.delete('endpoint');
    searchParams.delete('path');
    const remainingQuery = searchParams.toString();

    // Endpoints suportados
    const allowedEndpoints = ['', 'status', 'availability', 'penalties', 'validations', 'opening-hours', 'interruptions'];
    if (!allowedEndpoints.includes(endpointStr)) {
      return res.status(404).json({ error: 'Endpoint não suportado', traceId });
    }

    // Construir URL do iFood
    const endpointPath = endpointStr ? `/${endpointStr}` : '';
    const querySuffix = remainingQuery ? `?${remainingQuery}` : '';
    const iFoodUrl = `${IFOOD_BASE_URL}/v1.0/merchants/${merchantId}${endpointPath}${extraPath}${querySuffix}`;

    console.log('[ifood-merchant] trace', { traceId, merchantId, endpoint: endpointStr, url: iFoodUrl });

    const method = req.method || 'GET';
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = req.headers['content-type'] as string || 'application/json';
    }

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const rawBody = (req as any).rawBody;
      if (rawBody) {
        body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
      } else if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body != null) {
        body = JSON.stringify(req.body);
      }
    }

    const options: RequestInit = {
      method,
      headers,
      body,
    };

    const apiResponse = await fetch(iFoodUrl, options);
    const responseText = await apiResponse.text();

    console.log('[ifood-merchant] response', { status: apiResponse.status, preview: responseText.substring(0, 100) });

    res.status(apiResponse.status);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Trace-Id', traceId);
    return res.send(responseText);

  } catch (e: any) {
    console.error('[ifood-merchant] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
}
