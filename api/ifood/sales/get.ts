/**
 * @file dex-contabo/api/ifood/sales/get.ts
 * @description Handler para buscar vendas do iFood (GET /api/ifood/sales)
 */

import type { Request, Response } from 'express';

const IFOOD_BASE_URL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';

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
        'Accept': 'application/json',
        'User-Agent': 'dex-api/1.0',
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
