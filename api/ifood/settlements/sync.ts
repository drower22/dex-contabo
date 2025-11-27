/**
 * @file dex-contabo/api/ifood/settlements/sync.ts
 * @description Sincronização de Repasses (Settlements) do iFood
 * 
 * FLUXO:
 * 1. Recebe merchantId + dateRange no body
 * 2. Obtém token OAuth via Edge Function
 * 3. Chama API de Settlements v3.0
 * 4. Processa e salva dados na tabela ifood_settlements
 * 5. Relaciona settlements com pedidos (order_ids)
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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE || 'https://proxy.usa-dex.com.br/api/ifood-proxy';
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface SettlementItem {
  settlementId: string;
  balanceId?: string;
  settlementDate: string;
  settlementType?: string;
  grossAmount: number;
  netAmount: number;
  feesAmount: number;
  bankAccount?: {
    accountNumber?: string;
    branch?: string;
    bankCode?: string;
    bankName?: string;
  };
  status?: string;
  paymentMethod?: string;
  orders?: Array<{
    orderId: string;
    amount: number;
  }>;
}

/**
 * Obter token do iFood via Edge Function (mesmo padrão do sales)
 */
async function getIfoodToken(accountId: string): Promise<string> {
  console.log('🔑 [settlements-sync] Obtendo token para accountId:', accountId);
  
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'financial' }
  });

  if (error || !data?.access_token) {
    console.error('❌ [settlements-sync] Erro ao obter token:', error);
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [settlements-sync] Token obtido com sucesso');
  return data.access_token;
}

/**
 * Handler principal para sincronização de settlements
 * POST /api/ifood/settlements/sync
 * Body: { merchantId, accountId, startDate, endDate }
 */
export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { merchantId, accountId, startDate, endDate } = req.body;

    if (!merchantId || !accountId || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'merchantId, accountId, startDate, and endDate are required'
      });
    }

    console.log(`[settlements-sync] Iniciando sync para merchant ${merchantId}`, {
      trace_id: traceId,
      start_date: startDate,
      end_date: endDate
    });

    // 1. Buscar token via Edge Function
    let token: string;
    try {
      token = await getIfoodToken(accountId);
    } catch (error: any) {
      console.error('[settlements-sync] Erro ao obter token', { trace_id: traceId });
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Please authenticate with iFood first'
      });
    }

    // 2. Chamar API de Settlements v3.0 (padrão fetch+proxy do sales)
    const queryParams = new URLSearchParams({
      beginPaymentDate: startDate,  // API usa beginPaymentDate/endPaymentDate
      endPaymentDate: endDate
    }).toString();
    
    const path = `/financial/v3.0/merchants/${merchantId}/settlements?${queryParams}`;
    const proxyUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;

    console.log(`[settlements-sync] Chamando API via proxy`, {
      trace_id: traceId,
      path,
      proxyUrl
    });

    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'x-shared-key': IFOOD_PROXY_KEY!,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    console.log(`[settlements-sync] Response status:`, response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[settlements-sync] Erro na API:`, errorText);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    const settlements: SettlementItem[] = data?.settlements || [];

    console.log(`[settlements-sync] Recebidos ${settlements.length} settlements`, {
      trace_id: traceId
    });

    if (settlements.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No settlements found for the period',
        count: 0,
        trace_id: traceId
      });
    }

    // 3. Processar e salvar settlements
    const settlementRecords = settlements.map(settlement => ({
      account_id: accountId,
      merchant_id: merchantId,
      settlement_id: settlement.settlementId,
      balance_id: settlement.balanceId || null,
      settlement_date: settlement.settlementDate,
      settlement_type: settlement.settlementType || null,
      gross_amount: settlement.grossAmount || 0,
      net_amount: settlement.netAmount || 0,
      fees_amount: settlement.feesAmount || 0,
      bank_account_number: settlement.bankAccount?.accountNumber || null,
      bank_account_branch: settlement.bankAccount?.branch || null,
      bank_code: settlement.bankAccount?.bankCode || null,
      bank_name: settlement.bankAccount?.bankName || null,
      status: settlement.status || 'COMPLETED',
      payment_method: settlement.paymentMethod || null,
      order_ids: settlement.orders?.map(o => o.orderId) || [],
      order_count: settlement.orders?.length || 0,
      raw_data: settlement,
      synced_at: new Date().toISOString()
    }));

    // 4. Upsert no banco (atualiza se já existe)
    const { data: insertedData, error: insertError } = await supabase
      .from('ifood_settlements')
      .upsert(settlementRecords, {
        onConflict: 'account_id,merchant_id,settlement_id',
        ignoreDuplicates: false
      })
      .select('id');

    if (insertError) {
      console.error('[settlements-sync] Erro ao salvar settlements', {
        trace_id: traceId,
        error: insertError.message
      });
      return res.status(500).json({
        error: 'Failed to save settlements',
        message: insertError.message,
        trace_id: traceId
      });
    }

    console.log(`[settlements-sync] ${settlementRecords.length} settlements salvos com sucesso`, {
      trace_id: traceId
    });

    return res.status(200).json({
      success: true,
      message: 'Settlements synced successfully',
      count: settlementRecords.length,
      inserted: insertedData?.length || 0,
      trace_id: traceId,
      date_range: { startDate, endDate }
    });

  } catch (error: any) {
    console.error('[settlements-sync] Erro inesperado', {
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
