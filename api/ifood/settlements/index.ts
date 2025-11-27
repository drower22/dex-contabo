/**
 * @file dex-contabo/api/ifood/settlements/index.ts
 * @description Endpoint principal de Settlements (Repasses) do iFood
 * 
 * FLUXO:
 * 1. Recebe request com { ingest: true, fullYear: true, year, merchantId, accountId }
 * 2. Busca token OAuth via Edge Function
 * 3. Itera por cada mês do ano
 * 4. Chama API v3.0 de Settlements para cada semana (segunda a domingo)
 * 5. Salva dados na tabela ifood_settlements
 * 
 * API Reference:
 * GET /financial/v3.0/merchants/{merchantId}/settlements
 * Query params: beginPaymentDate, endPaymentDate
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/references#financial
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { startOfWeek, endOfWeek, addWeeks, format, startOfYear, endOfYear, isBefore, isAfter } from 'date-fns';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE || 'https://proxy.usa-dex.com.br/api/ifood-proxy';
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Obter token do iFood via Edge Function
 */
async function getIfoodToken(accountId: string): Promise<string> {
  console.log('🔑 [settlements] Obtendo token para accountId:', accountId);
  
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'financial' }
  });

  if (error || !data?.access_token) {
    console.error('❌ [settlements] Erro ao obter token:', error);
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [settlements] Token obtido com sucesso');
  return data.access_token;
}

/**
 * Buscar settlements de uma semana específica via proxy
 */
async function fetchSettlementsForWeek(
  token: string,
  merchantId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<any[]> {
  const beginPaymentDate = format(weekStart, 'yyyy-MM-dd');
  const endPaymentDate = format(weekEnd, 'yyyy-MM-dd');

  const queryParams = new URLSearchParams({
    beginPaymentDate,
    endPaymentDate
  }).toString();
  
  const path = `/financial/v3.0/merchants/${merchantId}/settlements?${queryParams}`;
  const proxyUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;

  console.log(`[settlements] 🔍 Buscando via proxy: ${beginPaymentDate} → ${endPaymentDate}`);
  console.log(`[settlements] 🔗 Proxy URL: ${proxyUrl}`);

  const response = await fetch(proxyUrl, {
    method: 'GET',
    headers: {
      'x-shared-key': IFOOD_PROXY_KEY!,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': 'Dex-Settlements/1.0'
    }
  });

  console.log(`[settlements] 📡 Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[settlements] ❌ Erro na API: ${response.status} - ${errorText}`);
    
    // Se for erro 401/403, pode ser problema de token
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Token inválido ou sem permissão: ${errorText}`);
    }
    
    return [];
  }

  const data: any = await response.json();
  const settlements = data?.settlements || [];
  
  console.log(`[settlements] ✅ Recebidos ${settlements.length} settlements`);
  return settlements;
}

/**
 * Persistir settlements no Supabase (tabela public.ifood_settlement_items)
 * Cada closingItem vira uma linha na tabela, com os dados principais + raw
 */
async function persistSettlementsToSupabase(
  accountId: string,
  merchantId: string,
  settlements: any[],
  traceId: string,
): Promise<number> {
  const rows: any[] = [];

  for (const s of settlements || []) {
    const startCalcRaw = s?.startDateCalculation ?? s?.startDate ?? null;
    const endCalcRaw = s?.endDateCalculation ?? s?.endDate ?? null;

    const startCalc = startCalcRaw ? String(startCalcRaw).slice(0, 10) : null;
    const endCalc = endCalcRaw ? String(endCalcRaw).slice(0, 10) : null;

    const closingItems = Array.isArray(s?.closingItems) ? s.closingItems : [];

    for (const item of closingItems) {
      if (!item) continue;

      const itemId = (item as any).id != null ? String((item as any).id) : null;
      if (!itemId) continue;

      const settlementIdRaw =
        (s as any).settlementId ||
        (s as any).id ||
        (item as any).settlementId ||
        (item as any).idSaldo ||
        null;

      const settlementId = settlementIdRaw ? String(settlementIdRaw) : `period:${startCalc ?? ''}-${endCalc ?? ''}`;

      const paymentDateRaw = (item as any).paymentDate || (item as any).settlementDate || null;
      const paymentDate = paymentDateRaw ? String(paymentDateRaw).slice(0, 10) : null;

      const expectedPaymentRaw = (item as any).expectedPaymentDate || null;
      const expectedPaymentDate = expectedPaymentRaw ? String(expectedPaymentRaw).slice(0, 10) : null;

      const dueDateRaw = (item as any).dueDate || null;
      const dueDate = dueDateRaw ? String(dueDateRaw).slice(0, 10) : null;

      const accountDetails = (item as any).accountDetails || {};
      const originDetails = Array.isArray((item as any).originDetails)
        ? (item as any).originDetails
        : [];

      const primaryOrigin = originDetails[0] || {};

      const row = {
        merchant_id: merchantId,
        account_id: accountId ?? null,
        settlement_id: settlementId,
        settlement_type: (item as any).settlementType ?? (item as any).type ?? null,
        start_date_calculation: startCalc,
        end_date_calculation: endCalc,
        expected_payment_date: expectedPaymentDate,
        source_period_start: startCalc,
        source_period_end: endCalc,
        item_id: itemId,
        transaction_id: (item as any).transactionId ?? null,
        type: (item as any).type ?? null,
        status: (item as any).status ?? null,
        sub_status: (item as any).subStatus ?? (item as any).sub_status ?? null,
        payment_date: paymentDate,
        due_date: dueDate,
        installment: (item as any).installment ?? (item as any).installments ?? null,
        amount: Number((item as any).amount ?? 0),
        net_value: Number((item as any).netAmount ?? (item as any).amount ?? 0),
        fee_value: Number((item as any).feeValue ?? (item as any).feesAmount ?? 0),
        bank_name: accountDetails.bankName ?? null,
        bank_code: accountDetails.bankNumber ?? accountDetails.bankCode ?? null,
        branch_code: accountDetails.branchCode ?? null,
        account_number: accountDetails.accountNumber ?? null,
        account_digit: accountDetails.accountDigit ?? null,
        document_number: accountDetails.documentNumber ?? null,
        raw: {
          settlementContext: {
            startDateCalculation: startCalcRaw,
            endDateCalculation: endCalcRaw,
          },
          closingItem: item,
          originDetails,
        },
      };

      rows.push(row);
    }
  }

  if (rows.length === 0) {
    console.log('[settlements] 💾 Nenhum settlement para salvar no Supabase', {
      trace_id: traceId,
    });
    return 0;
  }

  console.log('[settlements] 💾 Persistindo settlements no Supabase (ifood_settlement_items)', {
    trace_id: traceId,
    rows: rows.length,
  });

  const { data, error } = await supabase
    .from('ifood_settlement_items')
    .upsert(rows, { onConflict: 'merchant_id,settlement_id,item_id' })
    .select('id');

  if (error) {
    console.error('[settlements] ❌ Erro ao salvar settlements no Supabase', {
      trace_id: traceId,
      error: error.message,
    });
    throw new Error(`Erro ao salvar settlements no Supabase: ${error.message}`);
  }

  const affected = Array.isArray(data) ? data.length : rows.length;

  console.log('[settlements] 💾 Persistência concluída', {
    trace_id: traceId,
    inserted_or_updated: affected,
  });

  return affected;
}

/**
 * Handler principal
 * POST /api/ifood/settlements
 * 
 * SUPORTA 2 FORMATOS:
 * 1. FullYear: { ingest: true, fullYear: true, year, merchantId, accountId }
 * 2. Período: { ingest: true, merchantId, accountId, beginPaymentDate, endPaymentDate }
 */
export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  console.log('[settlements] 🚀 Handler iniciado', {
    method: req.method,
    body: req.body,
    trace_id: traceId
  });

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { 
      ingest, 
      fullYear, 
      year, 
      merchantId, 
      accountId: rawAccountId, 
      storeId,
      beginPaymentDate, 
      endPaymentDate,
      accessToken // Pode vir do frontend
    } = req.body;

    // Compatibilidade: aceitar tanto `accountId` quanto `storeId` vindo do frontend
    const accountId = rawAccountId || storeId;

    if (!ingest || !merchantId || !accountId) {
      console.warn('[settlements] ⚠️ Missing required parameters', {
        trace_id: traceId,
        ingest,
        merchantId,
        accountId,
        storeId,
      });

      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'ingest, merchantId, and accountId (ou storeId) são obrigatórios'
      });
    }

    // Validar formato
    const isFullYear = fullYear && year;
    const isPeriod = beginPaymentDate && endPaymentDate;
    
    if (!isFullYear && !isPeriod) {
      return res.status(400).json({
        error: 'Invalid format',
        message: 'Either (fullYear + year) or (beginPaymentDate + endPaymentDate) required'
      });
    }

    console.log(`[settlements] Iniciando ingestão`, {
      trace_id: traceId,
      type: isFullYear ? 'fullYear' : 'period',
      year: isFullYear ? year : null,
      period: isPeriod ? `${beginPaymentDate} → ${endPaymentDate}` : null,
      merchant_id: merchantId,
      account_id: accountId,
      store_id: storeId ?? null,
    });

    // 1. Buscar token (usar accessToken do frontend se disponível)
    let token: string;
    if (accessToken) {
      token = accessToken;
      console.log(`[settlements] ✅ Usando token do frontend (${accessToken.substring(0, 20)}...)`);
    } else {
      try {
        console.log('[settlements] 🔑 Buscando token via Edge Function...', {
          trace_id: traceId,
          account_id: accountId,
        });
        token = await getIfoodToken(accountId);
      } catch (error: any) {
        console.error('[settlements] ❌ Erro ao obter token via Edge Function', { 
          trace_id: traceId,
          error: error.message 
        });
        return res.status(401).json({
          error: 'OAuth token not found',
          message: 'Please authenticate with iFood first',
          details: error.message
        });
      }
    }

    // 2. Processar baseado no tipo de requisição
    const allSettlements: any[] = [];
    let weekCount = 0;

    if (isFullYear) {
      // MODO FULL YEAR: Iterar por semanas do ano (segunda a domingo)
      const yearStart = startOfYear(new Date(year, 0, 1));
      const yearEnd = endOfYear(new Date(year, 11, 31));
      
      let currentWeekStart = startOfWeek(yearStart, { weekStartsOn: 1 }); // Segunda-feira

      while (isBefore(currentWeekStart, yearEnd) || currentWeekStart.getTime() === yearEnd.getTime()) {
        const currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 }); // Domingo
        
        // Ajustar para não ultrapassar o ano
        const adjustedWeekEnd = isAfter(currentWeekEnd, yearEnd) ? yearEnd : currentWeekEnd;

        try {
          const settlements = await fetchSettlementsForWeek(
            token,
            merchantId,
            currentWeekStart,
            adjustedWeekEnd
          );

          if (settlements.length > 0) {
            allSettlements.push(...settlements);
            console.log(`[settlements] ✅ Semana ${format(currentWeekStart, 'yyyy-MM-dd')}: ${settlements.length} settlements`);
          }

          weekCount++;
        } catch (error: any) {
          console.error(`[settlements] ❌ Erro na semana ${format(currentWeekStart, 'yyyy-MM-dd')}:`, error.message);
        }

        // Próxima semana
        currentWeekStart = addWeeks(currentWeekStart, 1);
      }
    } else {
      // MODO PERÍODO: Buscar apenas o período específico
      const startDate = new Date(beginPaymentDate);
      const endDate = new Date(endPaymentDate);

      try {
        const settlements = await fetchSettlementsForWeek(
          token,
          merchantId,
          startDate,
          endDate
        );

        allSettlements.push(...settlements);
        weekCount = 1;
        
        console.log(`[settlements] ✅ Período ${beginPaymentDate} → ${endPaymentDate}: ${settlements.length} settlements`);
      } catch (error: any) {
        console.error(`[settlements] ❌ Erro no período ${beginPaymentDate} → ${endPaymentDate}:`, error.message);
      }
    }

    console.log(`[settlements] 📊 Total processado: ${allSettlements.length} settlements em ${weekCount} ${isFullYear ? 'semanas' : 'período(s)'}`);
    
    // 3. Salvar no banco (Supabase)
    const dbSavedItems = await persistSettlementsToSupabase(accountId, merchantId, allSettlements, traceId);

    // Resposta compatível com o que o botão "Hoje" espera
    const response = {
      success: true,
      message: isFullYear 
        ? `Ingestão de settlements concluída para ${year}`
        : `Ingestão de settlements concluída para período ${beginPaymentDate} → ${endPaymentDate}`,
      trace_id: traceId,
      processedItems: allSettlements.length, // Campo esperado pelo botão "Hoje" (quantidade de objetos settlement da API)
      settlementCount: allSettlements.length, // Campo esperado pelo botão "Hoje"
      dbSavedItems, // Quantidade de linhas inseridas/atualizadas na tabela ifood_settlements
      summary: {
        type: isFullYear ? 'fullYear' : 'period',
        year: isFullYear ? year : null,
        period: isPeriod ? `${beginPaymentDate} → ${endPaymentDate}` : null,
        weeksProcessed: weekCount,
        settlementsFound: allSettlements.length
      }
    };

    return res.status(200).json(response);

  } catch (error: any) {
    console.error('[settlements] Erro geral:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      trace_id: traceId
    });
  }
}
