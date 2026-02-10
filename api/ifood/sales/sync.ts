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

function formatDateYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDaysToDateString(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateYYYYMMDD(base);
}

function getTargetEndDate(): string {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  localMidnight.setDate(localMidnight.getDate() - 1);
  return formatDateYYYYMMDD(localMidnight);
}

async function computeIncrementalSyncRange(
  accountId: string,
  merchantId: string,
  overlapDays: number,
  initialLookbackDays: number
): Promise<{ periodStart: string; periodEnd: string } | null> {
  const targetEnd = getTargetEndDate();

  const { data: lastCompleted, error } = await supabase
    .from('ifood_sales_sync_status')
    .select('period_end')
    .eq('account_id', accountId)
    .eq('merchant_id', merchantId)
    .eq('status', 'completed')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('❌ [syncIfoodSales] Erro ao buscar último sync completed (ifood_sales_sync_status):', {
      message: (error as any).message,
      details: (error as any).details,
      hint: (error as any).hint,
      code: (error as any).code,
    });
  }

  const lastEnd = (lastCompleted as any)?.period_end as string | null;

  let startDate: string;
  if (lastEnd) {
    // overlapDays=3 => reprocessa lastEnd-2, lastEnd-1, lastEnd, ...
    startDate = addDaysToDateString(lastEnd, 1 - overlapDays);
  } else {
    startDate = addDaysToDateString(targetEnd, -initialLookbackDays);
  }

  if (startDate > targetEnd) return null;

  return { periodStart: startDate, periodEnd: targetEnd };
}

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
  const DEFAULT_PAGE_SIZE = 20;
  const path = `/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${beginDate}&endSalesDate=${endDate}&page=${page}`;
  const url = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;

  console.log(`📄 [syncIfoodSales] Buscando página ${page}...`);
  console.log(`📄 [syncIfoodSales] URL completa:`, url);
  console.log(`📄 [syncIfoodSales] Path iFood:`, path);

  const maxAttempts = 3;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-shared-key': IFOOD_PROXY_KEY!,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      console.log(`📥 [syncIfoodSales] Response status:`, response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();

        // 5xx/transientes: retry
        if (response.status >= 500 && attempt < maxAttempts) {
          console.warn(`⚠️ [syncIfoodSales] Erro ${response.status} ao buscar vendas (tentativa ${attempt}/${maxAttempts}). Retentando...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        // Alguns tenants retornam 400 quando a página solicitada excede pageCount.
        // Tratar como fim da paginação para não quebrar o sync.
        if (response.status === 400 && errorText.toLowerCase().includes('invalid page')) {
          // Alguns tenants rejeitam page=0 (exigem > 0). Nesse caso, é erro de configuração,
          // não "fim" de paginação.
          if (page <= 1) {
            console.error(`❌ [syncIfoodSales] Invalid page (cannot continue) page ${page}:`, errorText);
            throw new Error(`Invalid page (${page}) returned by iFood API`);
          }

          console.warn(`⚠️ [syncIfoodSales] Invalid page (treat as end) page ${page}:`, errorText);
          return { sales: [], hasMore: false };
        }

        // Caso comum de loja sem vendas no período: tratar como 0 vendas em vez de erro
        if (response.status === 404 && errorText.includes('No sales found between')) {
          console.warn(`⚠️ [syncIfoodSales] Nenhuma venda encontrada no período para a página ${page}:`, errorText);
          return { sales: [], hasMore: false };
        }

        console.error(`❌ [syncIfoodSales] Erro na página ${page}:`, errorText);
        throw new Error(`Erro ao buscar vendas: ${response.status}`);
      }

      const data: any = await response.json();
  console.log(`📊 [syncIfoodSales] Dados recebidos:`, {
    page: data.page,
    size: data.size,
    salesCount: data.sales?.length || 0,
    hasMorePages: data.hasMore,
    sampleSale: data.sales?.[0] ? { id: data.sales[0].id, createdAt: data.sales[0].createdAt } : null
  });
  
  const sales = data.sales || [];
  // IMPORTANT:
  // Alguns tenants retornam `size` como "quantidade de vendas nesta página" (não o pageSize).
  // Isso fazia a heurística achar que sempre tem próxima página, gerando requests extras
  // e ruído de "Invalid page ... pageCount = N".
  const pageCountRaw =
    typeof data.pageCount === 'number'
      ? data.pageCount
      : typeof data.totalPages === 'number'
        ? data.totalPages
        : typeof data.pages === 'number'
          ? data.pages
          : null;

  const hasMore =
    typeof data.hasMore === 'boolean'
      ? data.hasMore
      : typeof pageCountRaw === 'number'
        ? page < pageCountRaw
        : sales.length > 0 && sales.length === DEFAULT_PAGE_SIZE;

      console.log(`✅ [syncIfoodSales] Página ${page}: ${sales.length} vendas | hasMore: ${hasMore}`);
      return { sales, hasMore };
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || String(err);
      if (attempt < maxAttempts) {
        console.warn(`⚠️ [syncIfoodSales] Erro de rede ao buscar vendas (tentativa ${attempt}/${maxAttempts}): ${msg}. Retentando...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
    }
  }

  throw lastErr ?? new Error('Erro ao buscar vendas (sem detalhes)');
}

/**
 * Salvar vendas no Supabase (em lotes menores para evitar timeouts/erros de rede)
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

  const batchSize = 200; // limite de segurança para payload
  let totalSaved = 0;

  for (let i = 0; i < transformedSales.length; i += batchSize) {
    const batch = transformedSales.slice(i, i + batchSize);
    console.log(`💾 [syncIfoodSales] Upsert de lote ${i / batchSize + 1} com ${batch.length} vendas...`);

    try {
      const { error, count } = await supabase
        .from('ifood_sales')
        .upsert(batch, {
          onConflict: 'id',
          ignoreDuplicates: false,
          count: 'exact'
        });

      if (error) {
        console.error('❌ [syncIfoodSales] Erro ao salvar vendas (Supabase retornou erro):', {
          message: (error as any).message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
        });
        throw new Error('Erro ao salvar vendas no banco');
      }

      totalSaved += count ?? batch.length;
    } catch (e: any) {
      console.error('❌ [syncIfoodSales] Exceção ao chamar Supabase (possível fetch failed):', {
        message: e?.message,
        stack: e?.stack,
      });
      throw new Error('Erro ao salvar vendas no banco');
    }
  }

  console.log(`✅ [syncIfoodSales] ${totalSaved} vendas salvas (em lotes)`);
  return totalSaved;
}

export async function syncIfoodSales(req: Request, res: Response) {
  if (req.method === 'POST') {
    try {
      console.log('🚀 [API] POST /api/ifood/sales/sync - Iniciando sync direto');
      
      const {
        accountId: accountIdRaw,
        storeId,
        merchantId: merchantIdRaw,
        periodStart: periodStartRaw,
        periodEnd: periodEndRaw,
        syncMode,
        syncType,
        mode,
        async: asyncRaw,
      } = req.body;

      const accountId = String(accountIdRaw || storeId || '').trim();
      const merchantId = String(merchantIdRaw || '').trim();

      // Validações
      if (!accountId || !merchantId) {
        return res.status(400).json({
          error: 'Parâmetros obrigatórios: accountId, merchantId',
        });
      }

      const requestedMode = syncMode ?? syncType ?? mode;
      const normalizedMode =
        requestedMode === 'backfill' || requestedMode === 'incremental' ? requestedMode : 'incremental';

      const hasExplicitPeriod = Boolean(periodStartRaw && periodEndRaw);

      const runAsync = Boolean(asyncRaw);

      const computedRange =
        normalizedMode === 'incremental' && !hasExplicitPeriod
          ? await computeIncrementalSyncRange(accountId, merchantId, 3, 30)
          : null;

      const periodStart = hasExplicitPeriod
        ? String(periodStartRaw)
        : computedRange?.periodStart;
      const periodEnd = hasExplicitPeriod
        ? String(periodEndRaw)
        : computedRange?.periodEnd;

      if (!periodStart || !periodEnd) {
        return res.status(200).json({
          success: true,
          message: 'Nenhum período pendente para sincronização incremental',
          data: {
            salesSynced: 0,
            totalPages: 0,
            totalChunks: 0,
            periodStart: null,
            periodEnd: null,
          },
        });
      }

      console.log('📋 [API] Parâmetros:', { accountId, merchantId, periodStart, periodEnd, syncMode: normalizedMode });

      const nowIso = new Date().toISOString();

      // Registrar status (best-effort; se falhar não deve impedir o sync)
      try {
        const { error: statusUpsertError } = await supabase
          .from('ifood_sales_sync_status')
          .upsert(
            {
              account_id: accountId,
              merchant_id: merchantId,
              period_start: periodStart,
              period_end: periodEnd,
              status: 'in_progress',
              started_at: nowIso,
              completed_at: null,
              last_error: null,
            },
            {
              onConflict: 'account_id,merchant_id,period_start,period_end',
            }
          );

        if (statusUpsertError) {
          console.error('❌ [syncIfoodSales] Erro ao upsert ifood_sales_sync_status (in_progress):', {
            message: (statusUpsertError as any).message,
            details: (statusUpsertError as any).details,
            hint: (statusUpsertError as any).hint,
            code: (statusUpsertError as any).code,
          });
        }
      } catch (e: any) {
        console.error('❌ [syncIfoodSales] Exceção ao registrar ifood_sales_sync_status (in_progress):', {
          message: e?.message,
          stack: e?.stack,
        });
      }

      // 1. Obter token
      const runSync = async () => {
        // 1. Obter token
        const token = await getIfoodToken(accountId);

        // 2. Dividir período em chunks de 7 dias (limite da API iFood)
        const startDate = new Date(periodStart);
        const endDate = new Date(periodEnd);
        const chunks: Array<{ start: string; end: string }> = [];
      
        let currentStart = new Date(startDate);
        while (currentStart <= endDate) {
          const currentEnd = new Date(currentStart);
          currentEnd.setDate(currentEnd.getDate() + 6); // 7 dias (incluindo o dia inicial)
        
          if (currentEnd > endDate) {
            currentEnd.setTime(endDate.getTime());
          }
        
          chunks.push({
            start: currentStart.toISOString().split('T')[0],
            end: currentEnd.toISOString().split('T')[0],
          });
        
          currentStart.setDate(currentStart.getDate() + 7);
        }

        console.log(`📅 [API] Período dividido em ${chunks.length} chunks de 7 dias:`, chunks);

        // 3. Buscar vendas de cada chunk
        let allSales: any[] = [];
        let totalPages = 0;

        for (const chunk of chunks) {
          console.log(`📦 [API] Processando chunk: ${chunk.start} a ${chunk.end}`);
        
          // Alguns tenants do iFood exigem page > 0.
          let page = 1;
          let hasMore = true;

          while (hasMore) {
            const { sales, hasMore: more } = await fetchSalesPage(token, merchantId, chunk.start, chunk.end, page);
            allSales.push(...sales);
            hasMore = more;
            page += 1;
            totalPages++;

            // Limite de segurança (max 100 páginas por chunk)
            if (page >= 100) {
              console.warn(`⚠️ [syncIfoodSales] Limite de 100 páginas atingido no chunk ${chunk.start}-${chunk.end}`);
              break;
            }
          }
        }

        // Se não conseguimos buscar nada, não podemos apagar dados existentes.
        // (Evita "zerar" vendas por erro de paginação/token/integração.)
        if (allSales.length === 0) {
        console.warn('⚠️ [syncIfoodSales] Nenhuma venda retornada pela API. Pulando limpeza e upsert para evitar apagar dados existentes.', {
          accountId,
          merchantId,
          periodStart,
          periodEnd,
          totalChunks: chunks.length,
          totalPages,
        });

        try {
          const { error: statusUpdateError } = await supabase
            .from('ifood_sales_sync_status')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              total_sales: 0,
              total_pages: totalPages,
              last_error: null,
            })
            .eq('account_id', accountId)
            .eq('merchant_id', merchantId)
            .eq('period_start', periodStart)
            .eq('period_end', periodEnd);

          if (statusUpdateError) {
            console.error('❌ [syncIfoodSales] Erro ao atualizar ifood_sales_sync_status (completed/0 sales):', {
              message: (statusUpdateError as any).message,
              details: (statusUpdateError as any).details,
              hint: (statusUpdateError as any).hint,
              code: (statusUpdateError as any).code,
            });
          }
        } catch (e: any) {
          console.error('❌ [syncIfoodSales] Exceção ao atualizar ifood_sales_sync_status (completed/0 sales):', {
            message: e?.message,
            stack: e?.stack,
          });
        }

          return {
            statusCode: 200,
            payload: {
              success: true,
              message: 'Sincronização concluída (nenhuma venda retornada pela API)',
              data: {
                salesSynced: 0,
                totalPages,
                totalChunks: chunks.length,
                periodStart,
                periodEnd,
              },
            },
          };
        }

        const shouldDelete = normalizedMode === 'backfill' || hasExplicitPeriod;
        if (shouldDelete) {
        // 4. Limpar vendas existentes no período antes de salvar novas (somente para backfill/manual)
        console.log('🧹 [syncIfoodSales] Limpando vendas existentes no período antes de salvar novas...', {
          accountId,
          merchantId,
          periodStart,
          periodEnd,
          syncMode: normalizedMode,
        });

        const { error: deleteError } = await supabase
          .from('ifood_sales')
          .delete()
          .eq('account_id', accountId)
          .eq('merchant_id', merchantId)
          .gte('created_at', `${periodStart}T00:00:00`)
          .lte('created_at', `${periodEnd}T23:59:59.999Z`);

        if (deleteError) {
          console.error('❌ [syncIfoodSales] Erro ao limpar vendas existentes no período:', deleteError);
          throw new Error('Erro ao limpar vendas existentes no período');
        }
      } else {
        console.log('♻️ [syncIfoodSales] Modo incremental: pulando delete e fazendo apenas upsert (idempotente).', {
          accountId,
          merchantId,
          periodStart,
          periodEnd,
        });
      }

        // 5. Salvar no banco
        const savedCount = await saveSales(allSales, accountId, merchantId);

      try {
        const { error: statusUpdateError } = await supabase
          .from('ifood_sales_sync_status')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_sales: savedCount,
            total_pages: totalPages,
            last_error: null,
          })
          .eq('account_id', accountId)
          .eq('merchant_id', merchantId)
          .eq('period_start', periodStart)
          .eq('period_end', periodEnd);

        if (statusUpdateError) {
          console.error('❌ [syncIfoodSales] Erro ao atualizar ifood_sales_sync_status (completed):', {
            message: (statusUpdateError as any).message,
            details: (statusUpdateError as any).details,
            hint: (statusUpdateError as any).hint,
            code: (statusUpdateError as any).code,
          });
        }
      } catch (e: any) {
        console.error('❌ [syncIfoodSales] Exceção ao atualizar ifood_sales_sync_status (completed):', {
          message: e?.message,
          stack: e?.stack,
        });
      }

        console.log(`✅ [API] Sync concluído: ${savedCount} vendas sincronizadas em ${chunks.length} chunks`);

        return {
          statusCode: 200,
          payload: {
            success: true,
            message: 'Sincronização concluída',
            data: {
              salesSynced: savedCount,
              totalPages,
              totalChunks: chunks.length,
              periodStart,
              periodEnd,
            },
          },
        };
      };

      if (runAsync) {
        setImmediate(() => {
          void (async () => {
            try {
              await runSync();
            } catch (err: any) {
              const message = err?.message || String(err);
              console.error('❌ [API] Erro no sync (async):', message);
              try {
                await supabase
                  .from('ifood_sales_sync_status')
                  .update({
                    status: 'failed',
                    completed_at: new Date().toISOString(),
                    last_error: message.slice(0, 500),
                  })
                  .eq('account_id', accountId)
                  .eq('merchant_id', merchantId)
                  .eq('period_start', periodStart)
                  .eq('period_end', periodEnd);
              } catch {
                // ignore
              }
            }
          })();
        });

        return res.status(202).json({
          success: true,
          message: 'Sincronização iniciada (assíncrona). Acompanhe pelos logs/ifood_sales_sync_status.',
          data: { periodStart, periodEnd },
        });
      }

      const result = await runSync();
      return res.status(result.statusCode).json(result.payload);

    } catch (error: any) {
      console.error('❌ [API] Erro no sync:', error);

      try {
        const {
          accountId,
          merchantId,
          periodStart: periodStartRaw,
          periodEnd: periodEndRaw,
          syncMode,
        } = req.body || {};

        if (accountId && merchantId) {
          const mode = syncMode === 'backfill' || syncMode === 'incremental' ? syncMode : 'incremental';
          const hasExplicitPeriod = Boolean(periodStartRaw && periodEndRaw);

          const fallbackRange =
            !hasExplicitPeriod && mode === 'incremental'
              ? await computeIncrementalSyncRange(String(accountId), String(merchantId), 3, 30)
              : null;

          const periodStart = hasExplicitPeriod
            ? String(periodStartRaw)
            : fallbackRange?.periodStart;
          const periodEnd = hasExplicitPeriod
            ? String(periodEndRaw)
            : fallbackRange?.periodEnd;

          if (periodStart && periodEnd) {
            const { error: statusUpdateError } = await supabase
              .from('ifood_sales_sync_status')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                last_error: String(error?.message || error).slice(0, 500),
              })
              .eq('account_id', accountId)
              .eq('merchant_id', merchantId)
              .eq('period_start', periodStart)
              .eq('period_end', periodEnd);

            if (statusUpdateError) {
              console.error('❌ [syncIfoodSales] Erro ao atualizar ifood_sales_sync_status (failed):', {
                message: (statusUpdateError as any).message,
                details: (statusUpdateError as any).details,
                hint: (statusUpdateError as any).hint,
                code: (statusUpdateError as any).code,
              });
            }
          }
        }
      } catch (e: any) {
        console.error('❌ [syncIfoodSales] Exceção ao atualizar ifood_sales_sync_status (failed):', {
          message: e?.message,
          stack: e?.stack,
        });
      }

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
