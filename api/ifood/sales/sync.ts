/**
 * @file dex-contabo/api/ifood/sales/sync.ts
 * @description Handler para sincronização DIRETA de vendas do iFood (sem worker)
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE || 'https://proxy.usa-dex.com.br/api/ifood-proxy';
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Obter token do iFood via Edge Function
 */
async function getIfoodToken(accountId: string): Promise<string> {
  console.log('🔑 [syncIfoodSales] Obtendo token para accountId:', accountId);
  
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'financial' }
  });

  if (error || !data?.access_token) {
    console.error('❌ [syncIfoodSales] Erro ao obter token:', error);
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [syncIfoodSales] Token obtido com sucesso');
  return data.access_token;
}

/**
 * Buscar vendas de uma página
 */
async function fetchSalesPage(
  token: string,
  merchantId: string,
  beginDate: string,
  endDate: string,
  page: number
): Promise<{ sales: any[]; hasMore: boolean }> {
  const path = `/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${beginDate}&endSalesDate=${endDate}&page=${page}`;
  const url = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;

  console.log(`📄 [syncIfoodSales] Buscando página ${page}...`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-shared-key': IFOOD_PROXY_KEY!,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 400) {
      // Fim das páginas
      return { sales: [], hasMore: false };
    }
    const errorText = await response.text();
    console.error(`❌ [syncIfoodSales] Erro na página ${page}:`, errorText);
    throw new Error(`Erro ao buscar vendas: ${response.status}`);
  }

  const data: any = await response.json();
  const sales = data.sales || [];
  const hasMore = sales.length > 0 && sales.length === (data.size || 20);

  console.log(`✅ [syncIfoodSales] Página ${page}: ${sales.length} vendas`);
  return { sales, hasMore };
}

/**
 * Salvar vendas no Supabase
 */
async function saveSales(sales: any[], accountId: string, merchantId: string) {
  if (sales.length === 0) return 0;

  console.log(`💾 [syncIfoodSales] Salvando ${sales.length} vendas...`);

  const transformedSales = sales.map(sale => ({
    id: sale.id,
    account_id: accountId,
    merchant_id: merchantId,
    short_id: sale.shortId,
    created_at: sale.createdAt,
    type: sale.type,
    category: sale.category,
    current_status: sale.currentStatus,
    sales_channel: sale.salesChannel,
    sale_gross_value: sale.saleGrossValue,
    benefits: sale.benefits,
    delivery: sale.delivery,
    payments: sale.payments,
    billing_summary: sale.billingSummary,
    merchant: sale.merchant,
    order_status_history: sale.orderStatusHistory,
    order_events: sale.orderEvents,
    raw_data: sale,
    synced_at: new Date().toISOString(),
  }));

  const { error, count } = await supabase
    .from('ifood_sales')
    .upsert(transformedSales, {
      onConflict: 'id',
      ignoreDuplicates: false,
      count: 'exact'
    });

  if (error) {
    console.error('❌ [syncIfoodSales] Erro ao salvar vendas:', error);
    throw new Error('Erro ao salvar vendas no banco');
  }

  console.log(`✅ [syncIfoodSales] ${count || sales.length} vendas salvas`);
  return count || sales.length;
}

export async function syncIfoodSales(req: Request, res: Response) {
  if (req.method === 'POST') {
    try {
      console.log('🚀 [API] POST /api/ifood/sales/sync - Iniciando sync direto');
      
      const { accountId, merchantId, periodStart, periodEnd } = req.body;

      // Validações
      if (!accountId || !merchantId || !periodStart || !periodEnd) {
        return res.status(400).json({
          error: 'Parâmetros obrigatórios: accountId, merchantId, periodStart, periodEnd',
        });
      }

      console.log('📋 [API] Parâmetros:', { accountId, merchantId, periodStart, periodEnd });

      // 1. Obter token
      const token = await getIfoodToken(accountId);

      // 2. Buscar todas as páginas
      let page = 1;
      let allSales: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const { sales, hasMore: more } = await fetchSalesPage(
          token, merchantId, periodStart, periodEnd, page
        );
        allSales.push(...sales);
        hasMore = more;
        page++;

        // Limite de segurança (max 100 páginas)
        if (page > 100) {
          console.warn('⚠️ [syncIfoodSales] Limite de 100 páginas atingido');
          break;
        }
      }

      // 3. Salvar no banco
      const savedCount = await saveSales(allSales, accountId, merchantId);

      console.log(`✅ [API] Sync concluído: ${savedCount} vendas sincronizadas`);

      return res.status(200).json({
        success: true,
        message: 'Sincronização concluída',
        data: {
          salesSynced: savedCount,
          totalPages: page - 1,
          periodStart,
          periodEnd,
        },
      });

    } catch (error: any) {
      console.error('❌ [API] Erro no sync:', error);
      return res.status(500).json({
        error: 'Erro ao sincronizar vendas',
        message: error.message,
      });
    }
  }

  // GET para consultar status (não usado mais, mas mantido para compatibilidade)
  if (req.method === 'GET') {
    return res.status(200).json({
      message: 'Worker desabilitado. Use POST para sync direto.',
    });
  }
}
