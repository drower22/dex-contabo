const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

/**
 * Proxy unificado para todas as rotas de merchant do iFood
 * Rota: /api/ifood-merchant?merchantId=xxx&endpoint=yyy
 * Exemplos:
 * - /api/ifood-merchant?merchantId=123 (detalhes)
 * - /api/ifood-merchant?merchantId=123&endpoint=status
 * - /api/ifood-merchant?merchantId=123&endpoint=opening-hours
 * - /api/ifood-merchant?merchantId=123&endpoint=interruptions
 */
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-ifood-token, x-client-info, apikey, content-type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }

  const traceId = Date.now().toString(36);
  res.setHeader('X-Trace-Id', traceId);

  try {
    // Auth header
    const tokenHeader = req.headers['x-ifood-token'] || req.headers['authorization'] || '';
    const token = tokenHeader?.toLowerCase().startsWith('bearer ')
      ? tokenHeader.slice(7)
      : tokenHeader;
      
    if (!token) {
      return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });
    }

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
    const headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }

    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      const rawBody = req.rawBody;
      if (rawBody) {
        body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
      } else if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body != null) {
        body = JSON.stringify(req.body);
      }
    }

    const options = {
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

  } catch (e) {
    console.error('[ifood-merchant] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
};
