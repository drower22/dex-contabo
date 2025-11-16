import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { withCors } from '../_shared/cors';
import { buildIFoodUrl } from '../_shared/proxy';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

async function refreshLabHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { grantType, clientId: bodyClientId, clientSecret: bodyClientSecret, refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({ error: 'refreshToken é obrigatório' });
    return;
  }

  const effectiveGrant = (grantType as string) || 'refresh_token';

  // Permite informar clientId/clientSecret manualmente para reproduzir exatamente a API Reference,
  // mas se vierem vazios, usamos os valores do app financeiro por padrão.
  const clientId = bodyClientId || process.env.IFOOD_CLIENT_ID_FINANCIAL;
  const clientSecret = bodyClientSecret || process.env.IFOOD_CLIENT_SECRET_FINANCIAL;

  if (!clientId || !clientSecret) {
    res.status(400).json({
      error: 'Missing client credentials',
      message: 'Informe clientId/clientSecret no body ou configure IFOOD_CLIENT_ID_FINANCIAL / IFOOD_CLIENT_SECRET_FINANCIAL',
    });
    return;
  }

  const directUrl = buildIFoodUrl('/authentication/v1.0/oauth/token');
  const proxyBase = process.env.IFOOD_PROXY_BASE?.trim();
  const proxyKey = process.env.IFOOD_PROXY_KEY?.trim();

  const url = proxyBase
    ? `${proxyBase}?path=${encodeURIComponent('/authentication/v1.0/oauth/token')}`
    : directUrl;

  const requestBody = new URLSearchParams({
    grantType: effectiveGrant,
    clientId,
    clientSecret,
    refreshToken,
  });

  const requestBodyString = requestBody.toString();

  try {
    const headers: any = {
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (proxyBase && proxyKey) {
      headers['X-Shared-Key'] = proxyKey;
    }

    const response = await axios.post(url, requestBodyString, {
      headers,
      responseType: 'json',
      validateStatus: () => true, // queremos repassar status e body crus
    });

    res.status(response.status).json({
      status: response.status,
      data: response.data,
    });
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        error: 'AxiosError',
        status: error.response?.status || 500,
        data: error.response?.data,
        message: error.message,
      });
      return;
    }

    res.status(500).json({ error: 'Unexpected error', message: error?.message || String(error) });
  }
}

export default withCors(refreshLabHandler);
