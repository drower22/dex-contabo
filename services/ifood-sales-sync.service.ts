import { createClient } from '@supabase/supabase-js';
import type { IfoodSale, SyncJobData, SyncStatusRecord } from '../types/ifood-sales-sync.types';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Cliente Supabase com service role (bypass RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE || 'https://proxy.usa-dex.com.br/api/ifood-proxy';
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY || process.env.SHARED_PROXY_KEY!;

/**
 * Cria ou atualiza registro de sync status
 */
export async function createSyncStatus(data: SyncJobData): Promise<string> {
  const { data: syncStatus, error } = await supabase
    .from('ifood_sales_sync_status')
    .upsert({
      account_id: data.accountId,
      merchant_id: data.merchantId,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      status: 'pending',
      total_sales: 0,
      total_pages: 0,
      started_at: null,
      completed_at: null,
      last_error: null,
    }, {
      onConflict: 'account_id,merchant_id,period_start,period_end',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Erro ao criar sync status: ${error.message}`);
  }

  return syncStatus.id;
}

/**
 * Atualiza status do sync
 */
export async function updateSyncStatus(
  syncId: string,
  updates: Partial<SyncStatusRecord>
) {
  const { error } = await supabase
    .from('ifood_sales_sync_status')
    .update(updates)
    .eq('id', syncId);

  if (error) {
    console.error('Erro ao atualizar sync status:', error);
  }
}

/**
 * Busca vendas da API do iFood via proxy
 */
export async function fetchIfoodSales(
  token: string,
  merchantId: string,
  beginDate: string,
  endDate: string,
  page: number = 1
): Promise<{ sales: any[]; hasMore: boolean }> {
  const url = `${IFOOD_PROXY_BASE}?path=/financial/v3.0/merchants/${merchantId}/sales?beginSalesDate=${beginDate}&endSalesDate=${endDate}&page=${page}`;

  console.log('🌐 [fetchIfoodSales] Preparando requisição:', {
    url,
    proxyBase: IFOOD_PROXY_BASE,
    proxyKeyLength: IFOOD_PROXY_KEY?.length || 0,
    tokenLength: token?.length || 0,
    tokenPrefix: token?.substring(0, 20) + '...',
    merchantId,
    beginDate,
    endDate,
    page
  });

  const headers = {
    'x-shared-key': IFOOD_PROXY_KEY,
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };

  console.log('📋 [fetchIfoodSales] Headers:', {
    'x-shared-key': IFOOD_PROXY_KEY?.substring(0, 5) + '...' + IFOOD_PROXY_KEY?.substring(IFOOD_PROXY_KEY.length - 3),
    'Authorization': 'Bearer ' + token?.substring(0, 20) + '...',
    'Accept': 'application/json'
  });

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  console.log('📥 [fetchIfoodSales] Response:', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries())
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('❌ [fetchIfoodSales] Error body:', errorBody);
    
    if (response.status === 400) {
      // Fim das páginas
      return { sales: [], hasMore: false };
    }
    throw new Error(`Erro ao buscar vendas: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const sales = data.sales || [];
  const currentPage = data.page || page;
  const size = data.size || sales.length;
  
  // Calcular se há mais páginas baseado no total de vendas e página atual
  // Se a página atual * tamanho < total de vendas retornadas, há mais páginas
  // Mas como não temos total, vamos assumir que se retornou vendas = size, pode ter mais
  const hasMore = sales.length === size && sales.length > 0;

  console.log(`📄 [fetchIfoodSales] Página ${currentPage}: ${sales.length} vendas, hasMore: ${hasMore}`);

  return { sales, hasMore };
}

/**
 * Transforma venda da API do iFood para formato do Supabase
 */
function transformSale(sale: any, accountId: string): IfoodSale {
  return {
    id: sale.id,
    shortId: sale.shortId,
    accountId,
    merchantId: sale.merchant?.id,
    createdAt: sale.createdAt,
    currentStatus: sale.currentStatus,
    type: sale.type,
    category: sale.category,
    salesChannel: sale.salesChannel,
    merchantShortId: sale.merchant?.shortId,
    merchantName: sale.merchant?.name,
    merchantType: sale.merchant?.type,
    merchantCnpj: sale.merchant?.cnpj,
    merchantMcc: sale.merchant?.mcc,
    merchantCpf: sale.merchant?.cpf,
    merchantTimezone: sale.merchant?.timezone,
    bagValue: sale.bag?.value,
    deliveryFee: sale.deliveryFee,
    serviceFee: sale.serviceFee,
    benefitsTotal: sale.benefits?.total,
    benefitsTarget: sale.benefits?.target,
    benefitsValue: sale.benefits?.value,
    sponsorshipIfood: sale.sponsorship?.ifood,
    sponsorshipMerchant: sale.sponsorship?.merchant,
    sponsorshipExternal: sale.sponsorship?.external,
    sponsorshipChain: sale.sponsorship?.chain,
    deliveryInfoProvider: sale.deliveryInfo?.provider,
    deliveryType: sale.deliveryInfo?.type,
    deliveryLogisticProvider: sale.deliveryInfo?.logisticProvider,
    deliveryProduct: sale.deliveryInfo?.product,
    deliveryCode: sale.deliveryInfo?.code,
    deliverySchedulingType: sale.deliveryInfo?.schedulingType,
    deliveryGrossValue: sale.deliveryInfo?.grossValue,
    deliveryDiscount: sale.deliveryInfo?.discount,
    deliveryNetValue: sale.deliveryInfo?.netValue,
    paymentMethod: sale.payment?.method,
    paymentType: sale.payment?.type,
    paymentValue: sale.payment?.value,
    paymentCardBrand: sale.payment?.card?.brand,
    paymentLiability: sale.payment?.liability,
    paymentCurrency: sale.payment?.currency,
    saleBalance: sale.saleBalance,
    billingPaymentTransactionFee: sale.billing?.paymentTransactionFee,
    billingOrderPayment: sale.billing?.orderPayment,
    billingServiceFee: sale.billing?.serviceFee,
    billingOrderCommission: sale.billing?.orderCommission,
    billingStoreSubsidy: sale.billing?.storeSubsidy,
    billingIfoodSubsidy: sale.billing?.ifoodSubsidy,
    statusCreatedAt: sale.status?.createdAt,
    statusPlacedAt: sale.status?.placedAt,
    statusConfirmedAt: sale.status?.confirmedAt,
    statusDispatchedAt: sale.status?.dispatchedAt,
    statusConcludedAt: sale.status?.concludedAt,
    statusCancelledAt: sale.status?.cancelledAt,
    totalEvents: sale.events?.total,
    eventReceivedAt: sale.events?.received?.at,
    eventConfirmedAt: sale.events?.confirmed?.at,
    eventDeliveryDropCodeRequestedAt: sale.events?.deliveryDropCodeRequested?.at,
    eventDeliveryAcceptedAt: sale.events?.deliveryAccepted?.at,
    eventDeliveryGoingToOriginAt: sale.events?.deliveryGoingToOrigin?.at,
    eventDeliveryArrivedAtOriginAt: sale.events?.deliveryArrivedAtOrigin?.at,
    eventDispatchedAt: sale.events?.dispatched?.at,
    eventDeliveryArrivedAtDestinationAt: sale.events?.deliveryArrivedAtDestination?.at,
    eventDeliveryDropCodeValidationSuccessAt: sale.events?.deliveryDropCodeValidationSuccess?.at,
    eventConcludedAt: sale.events?.concluded?.at,
    eventFinancialBilledOrderEntryAt: sale.events?.financialBilledOrderEntry?.at,
    fboeExpectedPaymentDate: sale.events?.financialBilledOrderEntry?.expectedPaymentDate,
    fboePeriodBeginDate: sale.events?.financialBilledOrderEntry?.periodBeginDate,
    fboePeriodEndDate: sale.events?.financialBilledOrderEntry?.periodEndDate,
  };
}

/**
 * Salva vendas no Supabase em batch
 */
export async function saveSalesToSupabase(sales: any[], accountId: string): Promise<number> {
  if (sales.length === 0) {
    return 0;
  }

  const transformedSales = sales.map(sale => transformSale(sale, accountId));

  const { error, count } = await supabase
    .from('ifood_sales')
    .upsert(transformedSales, {
      onConflict: 'id',
      ignoreDuplicates: false, // Atualizar se já existir
      count: 'exact'
    })
    .select('id');

  if (error) {
    throw new Error(`Erro ao salvar vendas: ${error.message}`);
  }

  return count || 0;
}

/**
 * Registra log no Supabase
 */
export async function logToSupabase(
  level: 'info' | 'warn' | 'error',
  message: string,
  accountId?: string,
  context?: any
) {
  await supabase.from('logs').insert({
    level,
    message,
    account_id: accountId,
    context,
  });
}

/**
 * Busca token do iFood do Supabase
 */
export async function getIfoodToken(accountId: string): Promise<string> {
  console.log('🔍 [getIfoodToken] Buscando token para accountId:', accountId);
  
  const { data, error } = await supabase
    .from('ifood_store_auth')
    .select('account_id, access_token, scope, status, expires_at')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .eq('status', 'connected')
    .single();

  console.log('🔍 [getIfoodToken] Query result:', { 
    found: !!data, 
    error: error?.message,
    accountId: data?.account_id,
    hasToken: !!data?.access_token,
    tokenLength: data?.access_token?.length || 0,
    tokenPrefix: data?.access_token?.substring(0, 20) + '...',
    tokenSuffix: '...' + data?.access_token?.substring(data?.access_token?.length - 10),
    scope: data?.scope,
    status: data?.status,
    expiresAt: data?.expires_at
  });

  if (error || !data?.access_token) {
    console.error('❌ [getIfoodToken] Erro ao buscar token:', error);
    console.error('❌ [getIfoodToken] Data recebida:', data);
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [getIfoodToken] Token encontrado com sucesso');
  console.log('🔑 [getIfoodToken] Token type:', data.access_token.startsWith('eyJ') ? 'JWT válido' : 'Token inválido (não é JWT)');
  
  return data.access_token;
}
