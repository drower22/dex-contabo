/**
 * @file ingest-history.ts
 * @description Endpoint para ingestão histórica de vendas do iFood
 * Divide o período em chunks de 7 dias e processa cada um sequencialmente
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const IFOOD_BASE_URL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface IngestHistoryRequest {
  accountId: string;
  merchantId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

interface DateChunk {
  start: string;
  end: string;
}

/**
 * Divide um período em chunks de 7 dias
 */
function splitDateRangeIntoChunks(startDate: string, endDate: string): DateChunk[] {
  const chunks: DateChunk[] = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate);
  
  while (currentDate <= end) {
    const chunkEnd = new Date(currentDate);
    chunkEnd.setDate(chunkEnd.getDate() + 6); // 7 dias (0-6)
    
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime());
    }
    
    chunks.push({
      start: currentDate.toISOString().split('T')[0],
      end: chunkEnd.toISOString().split('T')[0]
    });
    
    currentDate.setDate(currentDate.getDate() + 7);
  }
  
  return chunks;
}

/**
 * Transforma dados da API do iFood para o formato do Supabase
 */
function transformSaleData(sale: any, accountId: string, merchantId: string) {
  return {
    // Identificação
    id: sale.id,
    short_id: sale.shortId,
    account_id: accountId,
    merchant_id: merchantId,
    
    // Datas
    created_at: sale.createdAt,
    synced_at: new Date().toISOString(),
    
    // Status e Tipo
    current_status: sale.currentStatus,
    type: sale.type,
    category: sale.category,
    sales_channel: sale.salesChannel,
    
    // Merchant Info
    merchant_short_id: sale.merchant?.shortId,
    merchant_name: sale.merchant?.name,
    merchant_type: sale.merchant?.type,
    merchant_cnpj: sale.merchant?.documents?.find((d: any) => d.type === 'CNPJ')?.value,
    merchant_mcc: sale.merchant?.documents?.find((d: any) => d.type === 'MCC')?.value,
    merchant_cpf: sale.merchant?.documents?.find((d: any) => d.type === 'CPF')?.value,
    merchant_timezone: sale.merchant?.timezone,
    
    // Valores Brutos
    bag_value: sale.saleGrossValue?.bag,
    delivery_fee: sale.saleGrossValue?.deliveryFee,
    service_fee: sale.saleGrossValue?.serviceFee,
    
    // Benefícios
    benefits_total: sale.benefits?.totalValue,
    benefits_target: sale.benefits?.benefits?.[0]?.target,
    benefits_value: sale.benefits?.benefits?.[0]?.value,
    sponsorship_ifood: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'IFOOD')?.value || 0,
    sponsorship_merchant: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'MERCHANT')?.value || 0,
    sponsorship_external: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'EXTERNAL')?.value || 0,
    sponsorship_chain: sale.benefits?.benefits?.[0]?.sponsorships?.find((s: any) => s.name === 'CHAIN')?.value || 0,
    
    // Entrega
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
    
    // Billing Summary
    sale_balance: sale.billingSummary?.saleBalance,
    billing_payment_transaction_fee: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'PAYMENT_TRANSACTION_FEE')?.value,
    billing_order_payment: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'ORDER_PAYMENT')?.value,
    billing_service_fee: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'SERVICE_FEE')?.value,
    billing_order_commission: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'ORDER_COMMISSION')?.value,
    billing_store_subsidy: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'STORE_SUBSIDY')?.value,
    billing_ifood_subsidy: sale.billingSummary?.billingEntries?.find((e: any) => e.name === 'IFOOD_SUBSIDY')?.value,
    
    // Status History
    status_created_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CREATED')?.createdAt,
    status_placed_at: sale.orderStatusHistory?.find((h: any) => h.value === 'PLACED')?.createdAt,
    status_confirmed_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CONFIRMED')?.createdAt,
    status_dispatched_at: sale.orderStatusHistory?.find((h: any) => h.value === 'DISPATCHED')?.createdAt,
    status_concluded_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CONCLUDED')?.createdAt,
    status_cancelled_at: sale.orderStatusHistory?.find((h: any) => h.value === 'CANCELLED')?.createdAt,
    
    // Eventos
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
    
    // FBOE Metadata
    fboe_expected_payment_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.expectedPaymentDate,
    fboe_period_begin_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.period?.beginDate,
    fboe_period_end_date: sale.orderEvents?.find((e: any) => e.fullCode === 'FINANCIAL_BILLED_ORDER_ENTRY')?.metadata?.entries?.[0]?.period?.endDate,
  };
}

/**
 * Handler principal
 */
export async function ingestHistoryHandler(req: Request, res: Response) {
  try {
    const { accountId, merchantId, startDate, endDate } = req.body as IngestHistoryRequest;
    
    // Validação
    if (!accountId || !merchantId || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required fields: accountId, merchantId, startDate, endDate'
      });
    }
    
    // Obter token do header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    
    const token = authHeader.replace('Bearer ', '').trim();
    
    console.log('[ingest-history] Starting ingestion:', {
      accountId,
      merchantId,
      startDate,
      endDate
    });
    
    // Dividir em chunks
    const chunks = splitDateRangeIntoChunks(startDate, endDate);
    console.log(`[ingest-history] Split into ${chunks.length} chunks`);
    
    let totalSales = 0;
    let totalPages = 0;
    
    // Processar cada chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[ingest-history] Processing chunk ${i + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);
      
      // Marcar como in_progress
      await supabase.from('ifood_sales_sync_status').upsert({
        account_id: accountId,
        merchant_id: merchantId,
        period_start: chunk.start,
        period_end: chunk.end,
        status: 'in_progress',
        started_at: new Date().toISOString()
      });
      
      try {
        let page = 1;
        let hasMore = true;
        let chunkSales = 0;
        
        while (hasMore) {
          const ifoodUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${chunk.start}&endSalesDate=${chunk.end}&page=${page}`;
          
          console.log(`[ingest-history] Fetching page ${page} for chunk ${i + 1}`);
          
          const response = await fetch(ifoodUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });
          
          if (!response.ok) {
            throw new Error(`iFood API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json() as any;
          const sales = data.sales || [];
          
          if (sales.length === 0) {
            hasMore = false;
            break;
          }
          
          // Transformar e inserir no Supabase
          const transformedSales = sales.map((sale: any) => transformSaleData(sale, accountId, merchantId));
          
          const { error: insertError } = await supabase
            .from('ifood_sales')
            .upsert(transformedSales, { onConflict: 'id' });
          
          if (insertError) {
            console.error('[ingest-history] Error inserting sales:', insertError);
            throw insertError;
          }
          
          chunkSales += sales.length;
          totalSales += sales.length;
          totalPages++;
          
          console.log(`[ingest-history] Inserted ${sales.length} sales from page ${page}`);
          
          // Verificar se há mais páginas
          if (sales.length < 100) { // Assumindo 100 por página
            hasMore = false;
          } else {
            page++;
          }
          
          // Rate limiting: aguardar 1s entre requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Marcar chunk como completed
        await supabase.from('ifood_sales_sync_status').upsert({
          account_id: accountId,
          merchant_id: merchantId,
          period_start: chunk.start,
          period_end: chunk.end,
          status: 'completed',
          total_sales: chunkSales,
          total_pages: page - 1,
          completed_at: new Date().toISOString()
        });
        
        console.log(`[ingest-history] Chunk ${i + 1}/${chunks.length} completed: ${chunkSales} sales`);
        
      } catch (chunkError: any) {
        console.error(`[ingest-history] Error processing chunk ${i + 1}:`, chunkError);
        
        // Marcar chunk como failed
        await supabase.from('ifood_sales_sync_status').upsert({
          account_id: accountId,
          merchant_id: merchantId,
          period_start: chunk.start,
          period_end: chunk.end,
          status: 'failed',
          last_error: chunkError.message,
          completed_at: new Date().toISOString()
        });
        
        // Continuar com próximo chunk
        continue;
      }
      
      // Rate limiting entre chunks: aguardar 2s
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('[ingest-history] Ingestion completed:', {
      totalSales,
      totalPages,
      totalChunks: chunks.length
    });
    
    return res.status(200).json({
      success: true,
      totalSales,
      totalPages,
      totalChunks: chunks.length,
      message: `Successfully ingested ${totalSales} sales in ${chunks.length} chunks`
    });
    
  } catch (error: any) {
    console.error('[ingest-history] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
