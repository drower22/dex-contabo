/**
 * @file dex-contabo/api/ifood/settlements/sync.ts
 * @description Sincronização de Repasses (Settlements) do iFood
 * 
 * FLUXO:
 * 1. Recebe merchantId + dateRange no body
 * 2. Obtém token OAuth do iFood
 * 3. Chama API de Payouts Unified (Settlements)
 * 4. Processa e salva dados na tabela ifood_settlements
 * 5. Relaciona settlements com pedidos (order_ids)
 * 
 * API Reference:
 * GET /financial/v1.0/payouts-unified
 * Query params: startDate, endDate, merchantId
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-settlements/
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

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
 * Handler principal para sincronização de settlements
 * POST /api/ifood/settlements/sync
 * Body: { merchantId, accountId, startDate, endDate }
 */
export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

    // 1. Buscar token OAuth para este merchant
    const { data: authData, error: authError } = await supabase
      .from('ifood_oauth_tokens')
      .select('access_token')
      .eq('account_id', accountId)
      .eq('merchant_id', merchantId)
      .eq('scope', 'financial')
      .single();

    if (authError || !authData?.access_token) {
      console.error('[settlements-sync] Token não encontrado', { trace_id: traceId });
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Please authenticate with iFood first'
      });
    }

    // 2. Chamar API de Settlements
    const settlementsUrl = `${IFOOD_BASE_URL}/financial/v1.0/payouts-unified`;
    const params = {
      merchantId,
      startDate, // YYYY-MM-DD
      endDate    // YYYY-MM-DD
    };

    console.log(`[settlements-sync] Chamando API: ${settlementsUrl}`, {
      trace_id: traceId,
      params
    });

    let apiResponse;
    
    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      // Usar proxy se configurado
      apiResponse = await axios.get(`${IFOOD_PROXY_BASE}/financial/v1.0/payouts-unified`, {
        params,
        headers: {
          'X-Shared-Key': IFOOD_PROXY_KEY,
          'X-Original-Authorization': `Bearer ${authData.access_token}`
        }
      });
    } else {
      // Chamada direta
      apiResponse = await axios.get(settlementsUrl, {
        params,
        headers: {
          'Authorization': `Bearer ${authData.access_token}`,
          'Content-Type': 'application/json'
        }
      });
    }

    const settlements: SettlementItem[] = apiResponse.data?.data || apiResponse.data || [];

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
