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
 * GET /financial/v1.0/anticipations
 * Query params: startDate, endDate, merchantId
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-anticipations/
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

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

/**
 * Handler principal para sincronização de anticipations
 * POST /api/ifood/anticipations/sync
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

    console.log(`[anticipations-sync] Iniciando sync para merchant ${merchantId}`, {
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
      console.error('[anticipations-sync] Token não encontrado', { trace_id: traceId });
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Please authenticate with iFood first'
      });
    }

    // 2. Chamar API de Anticipations
    const anticipationsUrl = `${IFOOD_BASE_URL}/financial/v1.0/anticipations`;
    const params = {
      merchantId,
      startDate, // YYYY-MM-DD
      endDate    // YYYY-MM-DD
    };

    console.log(`[anticipations-sync] Chamando API: ${anticipationsUrl}`, {
      trace_id: traceId,
      params
    });

    let apiResponse;
    
    if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
      // Usar proxy se configurado
      apiResponse = await axios.get(`${IFOOD_PROXY_BASE}/financial/v1.0/anticipations`, {
        params,
        headers: {
          'X-Shared-Key': IFOOD_PROXY_KEY,
          'X-Original-Authorization': `Bearer ${authData.access_token}`
        }
      });
    } else {
      // Chamada direta
      apiResponse = await axios.get(anticipationsUrl, {
        params,
        headers: {
          'Authorization': `Bearer ${authData.access_token}`,
          'Content-Type': 'application/json'
        }
      });
    }

    const anticipations: AnticipationItem[] = apiResponse.data?.data || apiResponse.data || [];

    console.log(`[anticipations-sync] Recebidas ${anticipations.length} antecipações`, {
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

    // 3. Processar e salvar anticipations
    const anticipationRecords = anticipations.map(anticipation => ({
      account_id: accountId,
      merchant_id: merchantId,
      anticipation_id: anticipation.anticipationId,
      balance_id: anticipation.balanceId || null,
      anticipation_date: anticipation.anticipationDate,
      original_payment_date: anticipation.originalPaymentDate || null,
      gross_amount: anticipation.grossAmount || 0,
      net_amount: anticipation.netAmount || 0,
      discount_amount: anticipation.discountAmount || 0,
      discount_rate: anticipation.discountRate || null,
      bank_account_number: anticipation.bankAccount?.accountNumber || null,
      bank_account_branch: anticipation.bankAccount?.branch || null,
      bank_code: anticipation.bankAccount?.bankCode || null,
      bank_name: anticipation.bankAccount?.bankName || null,
      status: anticipation.status || 'COMPLETED',
      anticipation_type: anticipation.anticipationType || null,
      order_ids: anticipation.orders?.map(o => o.orderId) || [],
      order_count: anticipation.orders?.length || 0,
      raw_data: anticipation,
      synced_at: new Date().toISOString()
    }));

    // 4. Upsert no banco (atualiza se já existe)
    const { data: insertedData, error: insertError } = await supabase
      .from('ifood_anticipations')
      .upsert(anticipationRecords, {
        onConflict: 'account_id,merchant_id,anticipation_id',
        ignoreDuplicates: false
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
