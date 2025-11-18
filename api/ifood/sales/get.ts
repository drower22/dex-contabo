/**
 * @file dex-contabo/api/ifood/sales/get.ts
 * @description Handler para buscar vendas do iFood (GET /api/ifood/sales)
 */

import type { Request, Response } from 'express';

const IFOOD_BASE_URL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';

// Configuração opcional de proxy (proxydex em Vercel)
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE; // ex: https://proxy.usa-dex.com.br/api/ifood-proxy
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY;   // deve bater com SHARED_PROXY_KEY no proxydex

/**
 * Handler para buscar vendas
 * GET /api/ifood/sales?merchantId=xxx&beginSalesDate=xxx&endSalesDate=xxx&page=1
 */
export async function salesGetHandler(req: Request, res: Response) {
  try {
    const { merchantId, beginSalesDate, endSalesDate, page } = req.query;

    // Validação
    if (!merchantId || !beginSalesDate || !endSalesDate) {
      return res.status(400).json({
        error: 'Missing required parameters: merchantId, beginSalesDate, endSalesDate'
      });
    }

    // Obter token do header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.toString().replace('Bearer ', '').trim();

    // Construir caminho da API do iFood (sem host) - será usado tanto direto quanto via proxy
    const pageNumber = page ? parseInt(page as string) : 1;
    const ifoodPath = `/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${beginSalesDate}&endSalesDate=${endSalesDate}&page=${pageNumber}`;

    const usingProxy = !!IFOOD_PROXY_BASE && !!IFOOD_PROXY_KEY;

    console.log('[ifood-sales] Preparing request to iFood:', {
      merchantId,
      beginSalesDate,
      endSalesDate,
      page: pageNumber,
      ifoodPath,
      usingProxy,
      proxyBase: IFOOD_PROXY_BASE,
      hasProxyKey: !!IFOOD_PROXY_KEY,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...'
    });

    let response: Response | any;

    if (usingProxy) {
      // Usar proxydex como intermediário
      const proxyUrl = new URL(IFOOD_PROXY_BASE!);
      proxyUrl.searchParams.set('path', ifoodPath);

      console.log('[ifood-sales] Calling iFood via proxy:', {
        proxyUrl: proxyUrl.toString()
      });

      response = await fetch(proxyUrl.toString(), {
        method: 'GET',
        headers: {
          'x-shared-key': IFOOD_PROXY_KEY!,
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
    } else {
      // Fallback: chamada direta para o iFood (comportamento original)
      const ifoodUrl = `${IFOOD_BASE_URL}${ifoodPath}`;

      console.log('[ifood-sales] Calling iFood API directly:', {
        url: ifoodUrl
      });

      response = await fetch(ifoodUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('[ifood-sales] iFood API response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ifood-sales] iFood API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });

      return res.status(response.status).json({
        error: 'iFood API error',
        status: response.status,
        message: errorText,
        url: ifoodUrl
      });
    }

    const data = await response.json() as any;

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

  } catch (error: any) {
    console.error('[ifood-sales] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
