/**
 * @file api/ifood/financial/payouts.ts
 * @description Endpoint que retorna payouts unificados (settlements + antecipações)
 * 
 * GET /api/ifood/financial/payouts?accountId=...&from=...&to=...
 * 
 * Lógica:
 * 1. Busca settlements no período via API iFood
 * 2. Busca antecipações no período via API iFood
 * 3. Mescla os dados priorizando antecipações quando existirem
 * 4. Retorna payouts unificados com summary
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Settlement {
  id: string;
  scheduledPayoutDate: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: string;
}

interface Anticipation {
  id: string;
  anticipatedPayoutDate: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: string;
  settlementIds?: string[];
}

interface UnifiedPayout {
  payoutDate: string;
  origin: 'settlement' | 'anticipation';
  settlementId?: string;
  anticipationId?: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: string;
  isAnticipated: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { accountId, from, to } = req.query;
  const authHeader = req.headers.authorization;

  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid accountId parameter' });
  }

  if (!from || typeof from !== 'string' || !to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid from/to date parameters (YYYY-MM-DD)' });
  }

  try {
    // 1. Busca access token do Supabase (scope: financial)
    let accessToken: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    } else {
      const { data: auth } = await supabase
        .from('ifood_store_auth')
        .select('access_token')
        .eq('account_id', accountId)
        .eq('scope', 'financial')
        .maybeSingle();

      if (auth?.access_token) {
        // Descriptografar se necessário (assumindo que está criptografado)
        // Por ora, vamos assumir que está em texto plano ou usar helper de crypto
        accessToken = auth.access_token as string;
      }
    }

    if (!accessToken) {
      return res.status(401).json({ 
        error: 'No access token found',
        message: 'Financial scope not authorized for this account'
      });
    }

    // 2. Busca merchantId do account
    const { data: account } = await supabase
      .from('accounts')
      .select('ifood_merchant_id')
      .eq('id', accountId)
      .single();

    if (!account?.ifood_merchant_id) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const merchantId = account.ifood_merchant_id;

    // 3. Busca settlements da API iFood
    const settlementsUrl = `${IFOOD_BASE_URL}/financial/v3/settlements?merchantId=${merchantId}&beginPaymentDate=${from}&endPaymentDate=${to}`;
    const settlementsResponse = await fetch(settlementsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
      },
    });

    let settlements: Settlement[] = [];
    if (settlementsResponse.ok) {
      const settlementsData = await settlementsResponse.json();
      // Extrair settlements do payload (ajustar conforme estrutura real da API)
      settlements = settlementsData.settlements || settlementsData.data || [];
    }

    // 4. Busca antecipações da API iFood (Financial v3.0)
    // Endpoint correto: /financial/v3.0/merchants/{merchantId}/anticipations
    const anticipationsUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/anticipations?beginAnticipatedPaymentDate=${from}&endAnticipatedPaymentDate=${to}`;
    const anticipationsResponse = await fetch(anticipationsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
      },
    });

    let anticipations: Anticipation[] = [];
    if (anticipationsResponse.ok) {
      const anticipationsData = await anticipationsResponse.json();
      // A estrutura real retorna settlements com closingItems do tipo REPASSE_ANTECIPADO_SEMANAL
      const anticipationSettlements = anticipationsData.settlements || [];
      
      // Processa os closingItems de antecipação
      for (const settlement of anticipationSettlements) {
        const items = settlement.closingItems || [];
        for (const item of items) {
          if (item.type && item.type.includes('ANTECIPADO')) {
            anticipations.push({
              id: `${settlement.startDateCalculation}_${settlement.endDateCalculation}_${item.anticipatedPaymentDate}`,
              anticipatedPayoutDate: item.anticipatedPaymentDate,
              grossAmount: Math.round((item.originalPaymentAmount || 0) * 100), // Converter para centavos
              feeAmount: Math.round((item.feeAmount || 0) * 100),
              netAmount: Math.round((item.anticipatedPaymentAmount || 0) * 100),
              status: item.status || 'UNKNOWN',
              settlementIds: [], // iFood não retorna vínculo explícito
            });
          }
        }
      }
    }

    // 5. Mescla settlements e antecipações
    const payouts: UnifiedPayout[] = [];
    const processedSettlementIds = new Set<string>();

    // Adiciona antecipações primeiro (prioridade)
    for (const ant of anticipations) {
      payouts.push({
        payoutDate: ant.anticipatedPayoutDate,
        origin: 'anticipation',
        anticipationId: ant.id,
        settlementId: ant.settlementIds?.[0], // Se houver vínculo
        grossAmount: ant.grossAmount,
        feeAmount: ant.feeAmount,
        netAmount: ant.netAmount,
        status: ant.status,
        isAnticipated: true,
      });

      // Marca settlements relacionados como processados
      if (ant.settlementIds) {
        ant.settlementIds.forEach(id => processedSettlementIds.add(id));
      }
    }

    // Adiciona settlements que não foram antecipados
    for (const settlement of settlements) {
      if (!processedSettlementIds.has(settlement.id)) {
        payouts.push({
          payoutDate: settlement.scheduledPayoutDate,
          origin: 'settlement',
          settlementId: settlement.id,
          grossAmount: settlement.grossAmount,
          feeAmount: settlement.feeAmount,
          netAmount: settlement.netAmount,
          status: settlement.status,
          isAnticipated: false,
        });
      }
    }

    // Ordena por data de payout
    payouts.sort((a, b) => a.payoutDate.localeCompare(b.payoutDate));

    // 6. Calcula summary
    const summary = {
      totalGross: payouts.reduce((sum, p) => sum + p.grossAmount, 0),
      totalFees: payouts.reduce((sum, p) => sum + p.feeAmount, 0),
      totalNet: payouts.reduce((sum, p) => sum + p.netAmount, 0),
      anticipatedCount: payouts.filter(p => p.origin === 'anticipation').length,
      settlementCount: payouts.filter(p => p.origin === 'settlement').length,
    };

    // 7. Retorna resposta
    return res.status(200).json({
      accountId,
      from,
      to,
      payouts,
      summary,
    });

  } catch (e: any) {
    console.error('[payouts] Exception:', e);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: e.message 
    });
  }
}
