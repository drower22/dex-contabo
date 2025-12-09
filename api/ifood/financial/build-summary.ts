import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getCompetenceDateRange(competence: string) {
  // competence no formato YYYY-MM
  const [yearStr, monthStr] = competence.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12

  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Competence inválida: ${competence}. Use formato YYYY-MM.`);
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // último dia do mês

  const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const payload = req.method === 'POST' ? (req.body || {}) : req.query;
  const accountId = typeof payload.accountId === 'string' ? payload.accountId : undefined;
  const merchantId = typeof payload.merchantId === 'string' ? payload.merchantId : undefined;
  const competence = typeof payload.competence === 'string' ? payload.competence : undefined; // YYYY-MM

  if (!accountId || !merchantId || !competence) {
    return res.status(400).json({
      error: 'missing_parameters',
      message: 'accountId, merchantId e competence (YYYY-MM) são obrigatórios',
    });
  }

  try {
    const { startDate, endDate } = getCompetenceDateRange(competence);

    console.log('[build-summary] Iniciando agregação', {
      accountId,
      merchantId,
      competence,
      startDate,
      endDate,
    });

    // Buscar dados de status por pedido dentro da competência
    const { data: orders, error } = await supabase
      .from('ifood_order_reconciliation_status')
      .select(
        'gross_from_sales, net_from_reconciliation, total_paid, total_anticipated'
      )
      .eq('account_id', accountId)
      .eq('merchant_id', merchantId)
      .gte('order_created_at', startDate)
      .lte('order_created_at', endDate);

    if (error) {
      console.error('[build-summary] Erro ao buscar status de pedidos', error.message);
      return res.status(500).json({
        error: 'db_error',
        message: error.message,
      });
    }

    const rows = orders || [];

    const sum = (getter: (row: any) => number | null | undefined) =>
      rows.reduce((acc, row) => {
        const v = getter(row);
        return acc + (typeof v === 'number' ? v : 0);
      }, 0);

    const grossSales = sum((r) => r.gross_from_sales);
    const netFromReconciliation = sum((r) => r.net_from_reconciliation);
    const totalPaid = sum((r) => r.total_paid);
    const totalAnticipated = sum((r) => r.total_anticipated);

    // Por enquanto, não descontamos taxas de antecipação aqui: delta simples
    const deltaFinancial = netFromReconciliation - (totalPaid + totalAnticipated);
    const isFullyReconciled = Math.abs(deltaFinancial) <= 0.1; // mesma tolerância do calculator

    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from('ifood_financial_summary')
      .upsert(
        {
          account_id: accountId,
          merchant_id: merchantId,
          competence,
          gross_sales: grossSales,
          net_from_reconciliation: netFromReconciliation,
          total_paid: totalPaid,
          total_anticipated: totalAnticipated,
          delta_financial: deltaFinancial,
          is_fully_reconciled: isFullyReconciled,
          sales_sync_complete: true,
          reconciliation_complete: true,
          payouts_sync_complete: true,
          anticipations_sync_complete: true,
          updated_at: nowIso,
        },
        {
          onConflict: 'account_id,merchant_id,competence',
        }
      );

    if (upsertError) {
      console.error('[build-summary] Erro ao salvar resumo financeiro', upsertError.message);
      return res.status(500).json({
        error: 'db_error',
        message: upsertError.message,
      });
    }

    return res.status(200).json({
      success: true,
      accountId,
      merchantId,
      competence,
      gross_sales: grossSales,
      net_from_reconciliation: netFromReconciliation,
      total_paid: totalPaid,
      total_anticipated: totalAnticipated,
      delta_financial: deltaFinancial,
      is_fully_reconciled: isFullyReconciled,
      period: { startDate, endDate },
      updated_at: nowIso,
      rows_count: rows.length,
    });
  } catch (err: any) {
    console.error('[build-summary] Erro inesperado', err);
    return res.status(500).json({
      error: 'internal_error',
      message: err?.message || String(err),
    });
  }
}
