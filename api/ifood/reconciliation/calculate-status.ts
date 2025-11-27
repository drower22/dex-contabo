/**
 * Endpoint para calcular status de conciliação de pedidos iFood
 * 
 * POST /api/ifood/reconciliation/calculate-status
 * 
 * Body: {
 *   accountId: string,
 *   merchantId: string
 * }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { IfoodReconciliationCalculator } from '../../../services/ifood-reconciliation-calculator';

interface RequestBody {
  accountId: string;
  merchantId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verificar método HTTP
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST requests are supported'
    });
  }

  try {
    // Validar body da requisição
    const { accountId, merchantId }: RequestBody = req.body;

    if (!accountId || !merchantId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'accountId and merchantId are required'
      });
    }

    console.log(`[reconciliation-api] Iniciando cálculo de status para account: ${accountId}, merchant: ${merchantId}`);

    // Executar cálculo de conciliação
    const calculator = new IfoodReconciliationCalculator();
    await calculator.processAccountReconciliation(accountId, merchantId);

    console.log(`[reconciliation-api] Cálculo de status concluído para account: ${accountId}, merchant: ${merchantId}`);

    return res.status(200).json({
      success: true,
      message: 'Reconciliation status calculation completed',
      data: {
        accountId,
        merchantId,
        processedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[reconciliation-api] Erro no cálculo de status:', error);

    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
}
