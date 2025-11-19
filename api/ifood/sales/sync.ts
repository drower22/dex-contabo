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
    // Valores brutos
    bag_value: sale.saleGrossValue?.bag,
    delivery_fee: sale.saleGrossValue?.deliveryFee,
    service_fee: sale.saleGrossValue?.serviceFee,
    // Benefícios
    benefits_total: sale.benefits?.totalValue,
    benefits_target: sale.benefits?.benefits?.[0]?.target,
    benefits_value: sale.benefits?.benefits?.[0]?.value,
    // Patrocínios
    sponsorship_ifood: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'IFOOD')?.value,
    sponsorship_merchant: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'MERCHANT')?.value,
    sponsorship_external: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'EXTERNAL')?.value,
    sponsorship_chain: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'CHAIN')?.value,
    // Merchant
    merchant_short_id: sale.merchant?.shortId,
    merchant_name: sale.merchant?.name,
    merchant_type: sale.merchant?.type,
    merchant_cnpj: sale.merchant?.documents?.find((d: any) => d.type === 'CNPJ')?.value,
    merchant_mcc: sale.merchant?.documents?.find((d: any) => d.type === 'MCC')?.value,
    merchant_cpf: sale.merchant?.documents?.find((d: any) => d.type === 'CPF')?.value,
    merchant_timezone: sale.merchant?.timezone,
    // Delivery
    delivery_info_provider: sale.delivery?.informationProvider?.name,
    delivery_type: sale.delivery?.type,
    delivery_logistic_provider: sale.delivery?.deliveryParameters?.logisticProvider,
    delivery_product: sale.delivery?.deliveryParameters?.deliveryProduct,
    delivery_code: sale.delivery?.deliveryParameters?.code,
    delivery_scheduling_type: sale.delivery?.deliveryParameters?.schedulingType,
    delivery_gross_value: sale.delivery?.prices?.grossValue,
    delivery_discount: sale.delivery?.prices?.discount,
    delivery_net_value: sale.delivery?.prices?.netValue,
    // Pagamento
    payment_method: sale.payments?.methods?.[0]?.method,
    payment_type: sale.payments?.methods?.[0]?.type,
    payment_value: sale.payments?.methods?.[0]?.value,
    payment_card_brand: sale.payments?.methods?.[0]?.card?.brand,
    payment_liability: sale.payments?.methods?.[0]?.liability,
    payment_currency: sale.payments?.methods?.[0]?.currency,
    // Billing
    sale_balance: sale.billingSummary?.saleBalance,
    billing_payment_transaction_fee: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'PAYMENT_TRANSACTION_FEE')?.value,
    billing_order_payment: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'ORDER_PAYMENT')?.value,
    billing_service_fee: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'SERVICE_FEE')?.value,
    billing_order_commission: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'ORDER_COMMISSION')?.value,
    billing_store_subsidy: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'STORE_SUBSIDY')?.value,
    billing_ifood_subsidy: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'IFOOD_SUBSIDY')?.value,
    // Status history
    status_created_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CREATED')?.createdAt,
    status_placed_at: sale.orderStatusHistory?.find((h: any) => h.value === 'PLACED')?.createdAt,
    status_confirmed_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CONFIRMED')?.createdAt,
    status_dispatched_at: sale.orderStatusHistory?.find((h: any) => h.value === 'DISPATCHED')?.createdAt,
    status_concluded_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CONCLUDED')?.createdAt,
    status_cancelled_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CANCELLED')?.createdAt,
    // Events
    total_events: sale.orderEvents?.length || 0,
    event_received_at: sale.orderEvents?.find((e: any) => e.fullCode === 'RECEIVED')?.createdAt,
    event_confirmed_at: sale.orderEvents?.find((e: any) => e.fullCode === 'CONFIRMED')?.createdAt,
    event_delivery_drop_code_requested_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_DROP_CODE_REQUESTED')?.createdAt,
    event_delivery_accepted_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_ACCEPTED')?.createdAt,
    event_delivery_going_to_origin_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_GOING_TO_ORIGIN')?.createdAt,
    event_delivery_arrived_at_origin_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_ARRIVED_AT_ORIGIN')?.createdAt,
    event_dispatched_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DISPATCHED')?.createdAt,
    event_delivery_arrived_at_destination_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_ARRIVED_AT_DESTINATION')?.createdAt,
    event_delivery_drop_code_validation_success_at: sale.orderEvents?.find((e: any) => e.fullCode === 'DELIVERY_DROP_CODE_VALIDATION_SUCCESS')?.createdAt,
    event_concluded_at: sale.orderEvents?.find((e: any) => e.fullCode === 'CONCLUDED')?.createdAt,
    event_financial_billed_order_entry_at: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.createdAt,
    // FBOE metadata
    fboe_expected_payment_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.expectedPaymentDate,
    fboe_period_begin_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.period?.beginDate,
    fboe_period_end_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.period?.endDate,
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
