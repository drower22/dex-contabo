/**
 * @file dex-contabo/api/ifood/sales/index.ts
 * @description Handler para buscar vendas do iFood
 * 
 * QUERY PARAMETERS:
 * - merchantId (obrigatório): ID do merchant no iFood
 * - beginSalesDate (obrigatório): Data inicial YYYY-MM-DD
 * - endSalesDate (obrigatório): Data final YYYY-MM-DD
 * - page (opcional): Página (default: 1)
 * 
 * HEADERS:
 * - authorization: Bearer {token}
 * 
 * @example
 * GET /api/ifood/sales?merchantId=abc123&beginSalesDate=2025-11-01&endSalesDate=2025-11-17&page=1
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  res.setHeader('Access-Control-Allow-Methods', cors['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { merchantId, beginSalesDate, endSalesDate, page } = req.query;

    // Validações
    if (!merchantId || typeof merchantId !== 'string') {
      return res.status(400).json({ 
        error: 'merchantId is required',
        example: '?merchantId=abc123&beginSalesDate=2025-11-01&endSalesDate=2025-11-17'
      });
    }

    if (!beginSalesDate || typeof beginSalesDate !== 'string') {
      return res.status(400).json({ 
        error: 'beginSalesDate is required (format: YYYY-MM-DD)',
        example: '?merchantId=abc123&beginSalesDate=2025-11-01&endSalesDate=2025-11-17'
      });
    }

    if (!endSalesDate || typeof endSalesDate !== 'string') {
      return res.status(400).json({ 
        error: 'endSalesDate is required (format: YYYY-MM-DD)',
        example: '?merchantId=abc123&beginSalesDate=2025-11-01&endSalesDate=2025-11-17'
      });
    }

    // Validar formato de data
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(beginSalesDate) || !dateRegex.test(endSalesDate)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD',
        beginSalesDate,
        endSalesDate
      });
    }

    // Pegar token do header
    const authHeader = req.headers['authorization'] || req.headers['x-ifood-token'];
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'Authorization header required',
        hint: 'Use: Authorization: Bearer {token}'
      });
    }

    const token = authHeader.toString().replace('Bearer ', '').trim();

    // Construir URL da API do iFood
    const pageNumber = page ? parseInt(page as string) : 1;
    const ifoodUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${beginSalesDate}&endSalesDate=${endSalesDate}&page=${pageNumber}`;

    console.log('[ifood-sales] Calling iFood API:', {
      merchantId,
      beginSalesDate,
      endSalesDate,
      page: pageNumber,
      url: ifoodUrl,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...'
    });

    // Chamar API do iFood
    const response = await fetch(ifoodUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    console.log('[ifood-sales] iFood API response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ifood-sales] iFood API error:', {
        status: response.status,
        error: errorText
      });

      return res.status(response.status).json({
        error: 'iFood API error',
        status: response.status,
        message: errorText,
        url: ifoodUrl
      });
    }

    const data = await response.json();

    console.log('[ifood-sales] Success:', {
      merchantId,
      page: data.page,
      size: data.size,
      salesCount: data.sales?.length || 0
    });

    // Retornar dados
    return res.status(200).json({
      success: true,
      data: {
        page: data.page,
        size: data.size,
        totalSales: data.sales?.length || 0,
        beginSalesDate,
        endSalesDate,
        sales: data.sales || []
      },
      metadata: {
        merchantId,
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[ifood-sales] Exception:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
