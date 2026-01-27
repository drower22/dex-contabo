/**
 * @file dex-contabo/api/ifood/anticipations/sync.ts
 * @description Sincronização de Antecipações do iFood
 * 
 * FLUXO:
 * 1. Recebe merchantId + dateRange no body
 * 2. Obtém token OAuth do iFood
 * 3. Chama API de Anticipations
 * 4. Processa e salva dados na tabela ifood_anticipations
 * 5. Relaciona antecipações com pedidos (order_ids)
 * 
 * API Reference:
 * GET /financial/v3.0/merchants/{merchantId}/anticipations
 * Query params (iFood): beginAnticipatedPaymentDate, endAnticipatedPaymentDate
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-anticipations/
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';
import axios from 'axios';
import zlib from 'zlib';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function normalizeUpstreamData(raw: unknown, traceId: string): any {
  try {
    if (raw == null) return raw;
    if (typeof raw === 'string') return JSON.parse(raw);

    let buf: Buffer | null = null;

    if (Buffer.isBuffer(raw)) {
      buf = raw;
    } else if (raw instanceof ArrayBuffer) {
      buf = Buffer.from(raw);
    } else if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    }

    if (buf) {
      const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
      const decoded = isGzip ? zlib.gunzipSync(buf) : buf;
      const text = decoded.toString('utf8');
      return JSON.parse(text);
    }

    return raw;
  } catch (err: any) {
    console.warn('[anticipations-sync] Falha ao normalizar upstream data', {
      trace_id: traceId,
      rawType: typeof raw,
      rawPreview: typeof raw === 'string' ? raw.slice(0, 200) : null,
      error: err?.message ?? String(err),
    });
    return raw;
  }
}

interface AnticipationItem {
  anticipationId: string;
  balanceId?: string;
  anticipationDate: string;
  originalPaymentDate?: string;
  grossAmount: number;
  netAmount: number;
  discountAmount: number;
  discountRate?: number;
  bankAccount?: {
    accountNumber?: string;
    branch?: string;
    bankCode?: string;
    bankName?: string;
  };
  status?: string;
  anticipationType?: string;
  orders?: Array<{
    orderId: string;
    amount: number;
  }>;
}

async function resolveMerchantId(accountId: string, traceId: string): Promise<string | null> {
  const { data: authRow, error: authError } = await supabase
    .from('ifood_store_auth')
    .select('ifood_merchant_id')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .maybeSingle();

  if (authError) {
    console.warn('[anticipations-sync] Falha ao buscar merchantId em ifood_store_auth', {
      trace_id: traceId,
      accountId,
      error: authError.message,
    });
  }

  const authMerchantId = (authRow as any)?.ifood_merchant_id as string | undefined;
  if (authMerchantId) return authMerchantId;

  const { data: accountRow, error: accountError } = await supabase
    .from('accounts')
    .select('ifood_merchant_id')
    .eq('id', accountId)
    .maybeSingle();

  if (accountError) {
    console.warn('[anticipations-sync] Falha ao buscar merchantId em accounts', {
      trace_id: traceId,
      accountId,
      error: accountError.message,
    });
  }

  return ((accountRow as any)?.ifood_merchant_id as string | undefined) ?? null;
}

async function getIfoodToken(accountId: string, traceId: string): Promise<string> {
  console.log('🔑 [anticipations-sync] Obtendo token para accountId (Edge Function ifood-get-token):', {
    trace_id: traceId,
    accountId,
    scope: 'financial',
  });

  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'financial' },
  });

  console.log('[anticipations-sync] ifood-get-token result', {
    trace_id: traceId,
    accountId,
    scope: 'financial',
    hasError: !!error,
    errorMessage: (error as any)?.message ?? null,
    dataKeys: data ? Object.keys(data) : null,
  });

  if (error || !data?.access_token) {
    console.error('❌ [anticipations-sync] Erro ao obter token ou access_token ausente', {
      trace_id: traceId,
      accountId,
      scope: 'financial',
      error,
      dataPreview: data ? { ...data, access_token: data.access_token ? '[REDACTED]' : undefined } : null,
    });
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [anticipations-sync] Token obtido com sucesso', {
    trace_id: traceId,
    accountId,
    scope: 'financial',
  });

  return data.access_token as string;
}

/**
 * Handler principal para sincronização de anticipations
 * POST /api/ifood/anticipations/sync
 * Body: { merchantId, accountId, startDate, endDate }
 */
export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      merchantId: merchantIdRaw,
      accountId: accountIdRaw,
      storeId: storeIdRaw,
      startDate: startDateRaw,
      endDate: endDateRaw,
    } = req.body;
    const accountId = (accountIdRaw || storeIdRaw) as string | undefined;

    if (!accountId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'accountId (or storeId) is required',
      });
    }

    const merchantId = (merchantIdRaw as string | undefined) ?? (await resolveMerchantId(accountId, traceId));

    if (!merchantId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'merchantId is required (or must exist in ifood_store_auth for this account)',
        trace_id: traceId,
      });
    }

    const endDate = (endDateRaw as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const startDate = (startDateRaw as string | undefined) ?? (() => {
      const d = new Date(endDate);
      d.setDate(d.getDate() - 90);
      return d.toISOString().slice(0, 10);
    })();

    console.log(`[anticipations-sync] Iniciando sync para merchant ${merchantId}`, {
      trace_id: traceId,
      start_date: startDate,
      end_date: endDate
    });

    // 1. Buscar token OAuth para este merchant via Edge Function (mesmo padrão dos settlements)
    let accessToken: string;
    try {
      accessToken = await getIfoodToken(accountId, traceId);
    } catch (error: any) {
      console.error('[anticipations-sync] Erro ao obter token', { trace_id: traceId });
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Please authenticate with iFood first',
        trace_id: traceId,
      });
    }

    // 2. Chamar API de Anticipations (v3.0 merchants) em janelas de até 30 dias
    const ifoodPath = `/financial/v3.0/merchants/${merchantId}/anticipations`;

    const allAnticipations: AnticipationItem[] = [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    let currentStart = new Date(start);
    while (currentStart <= end) {
      const windowEnd = new Date(currentStart);
      // Janela máxima de 30 dias (incluindo begin e end): begin + 29 dias
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 29);
      if (windowEnd > end) {
        windowEnd.setTime(end.getTime());
      }

      const begin = currentStart.toISOString().slice(0, 10);
      const endWindow = windowEnd.toISOString().slice(0, 10);
      const windowParams = {
        beginCalculationDate: begin,
        endCalculationDate: endWindow,
      } as const;

      console.log('[anticipations-sync] Chamando API de anticipations (janela)', {
        trace_id: traceId,
        path: ifoodPath,
        params: windowParams,
      });

      try {
        let apiResponse;

        if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
          // Usar proxydex em Vercel (padrão path + x-shared-key)
          // Aqui o proxy espera que TODO o path + query sejam enviados em "path".
          // Ex: path=/financial/.../anticipations?beginCalculationDate=...&endCalculationDate=...
          const proxyUrl = new URL(IFOOD_PROXY_BASE);
          const query = new URLSearchParams(windowParams as any).toString();
          const fullPath = query ? `${ifoodPath}?${query}` : ifoodPath;
          proxyUrl.searchParams.set('path', fullPath);

          console.log('[anticipations-sync] 🔄 Using proxy:', {
            url: proxyUrl.toString(),
            trace_id: traceId,
          });

          apiResponse = await axios.get(proxyUrl.toString(), {
            headers: {
              'x-shared-key': IFOOD_PROXY_KEY!,
              'Authorization': `Bearer ${accessToken}`,
              'Accept-Encoding': 'identity',
              'Accept': 'application/json',
            },
          });
        } else {
          // Fallback: chamada direta para o iFood
          const anticipationsUrl = `${IFOOD_BASE_URL}${ifoodPath}`;
          console.log('[anticipations-sync] ⚠️ Using direct call:', {
            url: anticipationsUrl,
            trace_id: traceId,
          });

          apiResponse = await axios.get(anticipationsUrl, {
            params: windowParams,
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });
        }

        // A API do iFood retorna um objeto com "settlements" neste endpoint de anticipations:
        // {
        //   beginDate, endDate, balance, merchantId, settlements: [...]
        // }
        const responseData = normalizeUpstreamData(apiResponse.data, traceId);
        const windowData: AnticipationItem[] =
          responseData?.settlements ||
          responseData?.data ||
          responseData?.anticipations ||
          responseData ||
          [];

        const settlements = Array.isArray(responseData?.settlements) ? responseData.settlements : [];
        const closingItemsCount = settlements.reduce((sum: number, s: any) => {
          const items = Array.isArray(s?.closingItems) ? s.closingItems.length : 0;
          return sum + items;
        }, 0);

        console.log('[anticipations-sync] Janela processada com sucesso', {
          trace_id: traceId,
          begin: windowParams.beginCalculationDate,
          end: windowParams.endCalculationDate,
          settlementsCount: Array.isArray(responseData?.settlements) ? responseData.settlements.length : 0,
          closingItemsCount,
          balance: typeof responseData?.balance === 'number' ? responseData.balance : null,
          dataCount: Array.isArray(windowData) ? windowData.length : 0,
        });

        if (Array.isArray(windowData) && windowData.length > 0) {
          allAnticipations.push(...windowData);
        }
      } catch (err: any) {
        const axiosErr = err as any;
        const status = axiosErr?.response?.status ?? 500;
        const body = axiosErr?.response?.data ?? axiosErr?.message ?? String(axiosErr);
        console.error('[anticipations-sync] Erro na API iFood (janela)', {
          trace_id: traceId,
          status,
          body: typeof body === 'string' ? body : JSON.stringify(body).slice(0, 1000),
        });

        return res.status(status).json({
          error: 'ifood_anticipations_api_error',
          message: 'Erro ao chamar API de antecipações do iFood',
          status,
          upstream: body,
          trace_id: traceId,
        });
      }

      // Avançar para próxima janela
      currentStart = new Date(windowEnd);
      currentStart.setUTCDate(currentStart.getUTCDate() + 1);
    }

    const anticipations: AnticipationItem[] = allAnticipations;

    console.log(`[anticipations-sync] Recebidas ${anticipations.length} antecipações (todas as janelas)`, {
      trace_id: traceId
    });

    if (anticipations.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No anticipations found for the period',
        count: 0,
        trace_id: traceId
      });
    }

    // 3. Processar e salvar anticipations (alinhado ao schema final ifood_anticipations)
    // A resposta real do iFood traz um objeto com `closingItems` dentro.
    // Cada item de closingItems representa uma antecipação com valores e datas.
    const anticipationRecords = anticipations.flatMap((anticipation: any) => {
      const closingItems: any[] = Array.isArray(anticipation?.closingItems)
        ? anticipation.closingItems
        : [];

      const startCalc = anticipation?.startDateCalculation ?? startDate;
      const endCalc = anticipation?.endDateCalculation ?? endDate;

      if (closingItems.length === 0) {
        return [];
      }

      return closingItems.map((item: any) => {
        const accountDetails = item?.accountDetails ?? {};

        const originalPaymentDate = item?.originalPaymentDate
          ? String(item.originalPaymentDate).slice(0, 10)
          : null;
        const anticipatedPaymentDate = item?.anticipatedPaymentDate
          ? String(item.anticipatedPaymentDate).slice(0, 10)
          : null;
        const type = item?.type ?? null;
        const originalPaymentAmount = item?.originalPaymentAmount ?? 0;
        const anticipationIdKey = [
          merchantId,
          startCalc,
          endCalc,
          type,
          originalPaymentDate,
          anticipatedPaymentDate,
          String(originalPaymentAmount),
        ].join('|');
        const anticipationId = createHash('sha1').update(anticipationIdKey).digest('hex');

        return {
          account_id: accountId,
          merchant_id: merchantId,
          anticipation_id: anticipationId,
          // Valores financeiros principais
          original_payment_amount: originalPaymentAmount,
          fee_percentage: item?.feePercentage ?? null,
          fee_amount: item?.feeAmount ?? 0,
          anticipated_payment_amount: item?.anticipatedPaymentAmount ?? 0,
          net_amount: item?.anticipatedPaymentAmount ?? 0,
          // Datas
          anticipation_date: anticipatedPaymentDate,
          original_payment_date: originalPaymentDate,
          anticipated_payment_date: anticipatedPaymentDate,
          // Campos de período (usar informações do bloco de closingItems + range global)
          start_date_calculation: startCalc,
          end_date_calculation: endCalc,
          source_period_start: startDate,
          source_period_end: endDate,
          // Dados bancários
          bank_name: accountDetails?.bankName ?? null,
          bank_number: accountDetails?.bankNumber ?? null,
          branch_code: accountDetails?.branchCode ?? null,
          account_number: accountDetails?.accountNumber ?? null,
          account_digit: accountDetails?.accountDigit ?? null,
          // Metadados
          status: item?.status ?? null,
          type: item?.type ?? null,
          order_ids: [],
          raw: {
            ...anticipation,
            closingItem: item,
          },
        };
      });
    });

    // 4. Upsert no banco (atualiza se já existe) usando o índice único definido no DDL
    const { data: insertedData, error: insertError } = await supabase
      .from('ifood_anticipations')
      .upsert(anticipationRecords, {
        onConflict:
          'account_id,merchant_id,type,original_payment_date,anticipated_payment_date,original_payment_amount',
        ignoreDuplicates: false,
      })
      .select('id');

    if (insertError) {
      console.error('[anticipations-sync] Erro ao salvar antecipações', {
        trace_id: traceId,
        error: insertError.message
      });
      return res.status(500).json({
        error: 'Failed to save anticipations',
        message: insertError.message,
        trace_id: traceId
      });
    }

    console.log(`[anticipations-sync] ${anticipationRecords.length} antecipações salvas com sucesso`, {
      trace_id: traceId
    });

    return res.status(200).json({
      success: true,
      message: 'Anticipations synced successfully',
      count: anticipationRecords.length,
      inserted: insertedData?.length || 0,
      trace_id: traceId,
      date_range: { startDate, endDate }
    });

  } catch (error: any) {
    console.error('[anticipations-sync] Erro inesperado', {
      trace_id: traceId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      trace_id: traceId
    });
  }
}
