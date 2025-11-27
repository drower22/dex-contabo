/**
 * Serviço de Cálculo de Status de Conciliação iFood
 * 
 * Implementa a lógica de transição de status conforme documento:
 * dex-contabo/docs/ifood-finance-conciliation.md
 */

import { createClient } from '@supabase/supabase-js';

// Logger simples para logs estruturados
class SimpleLogger {
  constructor(private service: string) {}
  
  async info(message: string, data?: any) {
    console.log(`[${this.service}] INFO:`, message, data || '');
  }
  
  async error(message: string, data?: any) {
    console.error(`[${this.service}] ERROR:`, message, data || '');
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface OrderReconciliationData {
  account_id: string;
  merchant_id: string;
  order_id: string;
  order_created_at: string;
  gross_from_sales: number;
  sales_channel?: string;
  payment_method?: string;
  net_from_reconciliation?: number;
  expected_payment_date?: string;
  is_cancelled?: boolean;
  total_paid?: number;
  total_anticipated?: number;
  first_payment_date?: string;
  last_payment_date?: string;
}

interface StatusCalculationResult {
  status: 'sales_only' | 'awaiting_settlement' | 'reconciled' | 'divergent' | 'cancelled';
  divergence_reason?: string;
  divergence_amount?: number;
}

export class IfoodReconciliationCalculator {
  private logger: SimpleLogger;
  
  // Configurações de tolerância
  private readonly VALUE_TOLERANCE = 0.10; // R$ 0,10
  private readonly PAYMENT_DELAY_TOLERANCE_DAYS = 3; // 3 dias após data prevista

  constructor() {
    this.logger = new SimpleLogger('ifood-reconciliation-calculator');
  }

  /**
   * Calcula o status de conciliação para um pedido
   */
  calculateStatus(data: OrderReconciliationData): StatusCalculationResult {
    // 1. Verificar se foi cancelado
    if (data.is_cancelled) {
      return { status: 'cancelled' };
    }

    // 2. Se não tem dados de conciliação ainda
    if (!data.net_from_reconciliation && data.net_from_reconciliation !== 0) {
      return { status: 'sales_only' };
    }

    // 3. Se tem conciliação mas não tem pagamentos
    if (!data.total_paid && data.total_paid !== 0) {
      return { status: 'awaiting_settlement' };
    }

    // 4. Calcular diferença entre esperado e pago
    const totalReceived = (data.total_paid || 0) + (data.total_anticipated || 0);
    const expectedAmount = data.net_from_reconciliation || 0;
    const difference = Math.abs(totalReceived - expectedAmount);

    // 5. Se valores batem (dentro da tolerância)
    if (difference <= this.VALUE_TOLERANCE) {
      return { status: 'reconciled' };
    }

    // 6. Se há divergência de valor
    if (difference > this.VALUE_TOLERANCE) {
      return {
        status: 'divergent',
        divergence_reason: `Diferença de valor: esperado R$ ${expectedAmount.toFixed(2)}, recebido R$ ${totalReceived.toFixed(2)}`,
        divergence_amount: totalReceived - expectedAmount
      };
    }

    // 7. Se passou da data prevista + tolerância sem pagamento
    if (data.expected_payment_date && !data.total_paid) {
      const expectedDate = new Date(data.expected_payment_date);
      const toleranceDate = new Date(expectedDate);
      toleranceDate.setDate(toleranceDate.getDate() + this.PAYMENT_DELAY_TOLERANCE_DAYS);
      
      if (new Date() > toleranceDate) {
        return {
          status: 'divergent',
          divergence_reason: `Pagamento em atraso: esperado em ${expectedDate.toLocaleDateString('pt-BR')}, já passaram ${this.PAYMENT_DELAY_TOLERANCE_DAYS} dias de tolerância`
        };
      }
    }

    // Default: aguardando liquidação
    return { status: 'awaiting_settlement' };
  }

  /**
   * Processa todos os pedidos de uma loja e atualiza seus status
   */
  async processAccountReconciliation(accountId: string, merchantId: string): Promise<void> {
    const traceId = `reconciliation-${accountId}-${merchantId}-${Date.now()}`;
    
    try {
      await this.logger.info('Iniciando processamento de conciliação', {
        account_id: accountId,
        merchant_id: merchantId,
        trace_id: traceId
      });

      // 1. Buscar todos os pedidos da loja
      const salesData = await this.getSalesData(accountId, merchantId);
      await this.logger.info(`Encontrados ${salesData.length} pedidos para processar`, { trace_id: traceId });

      // 2. Para cada pedido, calcular status
      let processedCount = 0;
      let errorCount = 0;
      const BATCH_SIZE = 50; // Processar em lotes de 50 pedidos
      
      // Processar em lotes para melhor performance
      for (let i = 0; i < salesData.length; i += BATCH_SIZE) {
        const batch = salesData.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (sale) => {
            // Buscar dados de conciliação para este pedido
            const reconciliationData = await this.getReconciliationData(accountId, merchantId, sale.order_id);
            
            // Buscar dados de pagamentos para este pedido
            const paymentData = await this.getPaymentData(accountId, merchantId, sale.order_id);

            // Combinar todos os dados
            const orderData: OrderReconciliationData = {
              account_id: accountId,
              merchant_id: merchantId,
              order_id: sale.order_id,
              order_created_at: sale.created_at,
              gross_from_sales: sale.bag_value + (sale.delivery_fee || 0),
              sales_channel: sale.sales_channel,
              payment_method: sale.payment_method,
              ...reconciliationData,
              ...paymentData
            };

            // Calcular novo status
            const statusResult = this.calculateStatus(orderData);

            // Salvar/atualizar na tabela de status
            await this.upsertOrderStatus(orderData, statusResult, traceId);
            
            return { success: true, order_id: sale.order_id };
          })
        );

        // Contar sucessos e erros do lote
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            processedCount++;
          } else {
            errorCount++;
            await this.logger.error(`Erro ao processar pedido no lote`, {
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
              trace_id: traceId
            });
          }
        }

        await this.logger.info(`Lote processado: ${i + batch.length}/${salesData.length}`, {
          processed: processedCount,
          errors: errorCount,
          trace_id: traceId
        });
      }

      await this.logger.info('Processamento de conciliação concluído', {
        account_id: accountId,
        merchant_id: merchantId,
        processed_count: processedCount,
        error_count: errorCount,
        trace_id: traceId
      });

    } catch (error) {
      await this.logger.error('Erro no processamento de conciliação', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
        merchant_id: merchantId,
        trace_id: traceId
      });
      throw error;
    }
  }

  /**
   * Busca dados de vendas (Sales API)
   */
  private async getSalesData(accountId: string, merchantId: string) {
    const { data, error } = await supabase
      .from('ifood_sales')
      .select('order_id, created_at, bag_value, delivery_fee, sales_channel, payment_method')
      .eq('account_id', accountId)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Busca dados de conciliação (Reconciliation API)
   * Fonte: tabela ifood_conciliation
   */
  private async getReconciliationData(accountId: string, merchantId: string, orderId: string) {
    const { data, error } = await supabase
      .from('ifood_conciliation')
      .select('transaction_value, expected_payment_date, transaction_type, transaction_description')
      .eq('account_id', accountId)
      .eq('merchant_id', merchantId)
      .eq('ifood_order_id', orderId)
      .order('event_date', { ascending: false });

    if (error) {
      await this.logger.error('Erro ao buscar dados de conciliação', {
        error: error.message,
        order_id: orderId
      });
      return {
        net_from_reconciliation: null,
        expected_payment_date: null,
        is_cancelled: false
      };
    }

    if (!data || data.length === 0) {
      // Pedido ainda não apareceu na conciliação
      return {
        net_from_reconciliation: null,
        expected_payment_date: null,
        is_cancelled: false
      };
    }

    // Verificar se há cancelamento/estorno
    const hasCancellation = data.some(row => 
      row.transaction_type?.toLowerCase().includes('cancel') ||
      row.transaction_type?.toLowerCase().includes('estorno') ||
      row.transaction_description?.toLowerCase().includes('cancel') ||
      row.transaction_description?.toLowerCase().includes('estorno')
    );

    // Calcular valor líquido somando todos os eventos financeiros deste pedido
    const netValue = data.reduce((sum, row) => {
      const value = row.transaction_value || 0;
      return sum + value;
    }, 0);

    // Pegar a data de pagamento esperada (do evento mais recente)
    const expectedDate = data[0]?.expected_payment_date || null;

    return {
      net_from_reconciliation: netValue,
      expected_payment_date: expectedDate,
      is_cancelled: hasCancellation
    };
  }

  /**
   * Busca dados de pagamentos (Settlements + Anticipations)
   * Fonte: tabelas ifood_settlements e ifood_anticipations
   */
  private async getPaymentData(accountId: string, merchantId: string, orderId: string) {
    let totalPaid = 0;
    let totalAnticipated = 0;
    let firstPaymentDate: string | null = null;
    let lastPaymentDate: string | null = null;

    try {
      // 1. Buscar settlements que incluem este pedido
      const { data: settlements, error: settlementsError } = await supabase
        .from('ifood_settlements')
        .select('net_amount, settlement_date, order_ids')
        .eq('account_id', accountId)
        .eq('merchant_id', merchantId)
        .contains('order_ids', [orderId]); // Busca pedido no array

      if (settlementsError) {
        await this.logger.error('Erro ao buscar settlements', {
          error: settlementsError.message,
          order_id: orderId
        });
      } else if (settlements && settlements.length > 0) {
        // Somar valores dos settlements
        totalPaid = settlements.reduce((sum, s) => sum + (s.net_amount || 0), 0);
        
        // Pegar datas
        const dates = settlements
          .map(s => s.settlement_date)
          .filter(d => d)
          .sort();
        
        if (dates.length > 0) {
          firstPaymentDate = dates[0];
          lastPaymentDate = dates[dates.length - 1];
        }
      }

      // 2. Buscar anticipations que incluem este pedido
      const { data: anticipations, error: anticipationsError } = await supabase
        .from('ifood_anticipations')
        .select('net_amount, anticipation_date, order_ids')
        .eq('account_id', accountId)
        .eq('merchant_id', merchantId)
        .contains('order_ids', [orderId]); // Busca pedido no array

      if (anticipationsError) {
        await this.logger.error('Erro ao buscar anticipations', {
          error: anticipationsError.message,
          order_id: orderId
        });
      } else if (anticipations && anticipations.length > 0) {
        // Somar valores das antecipações
        totalAnticipated = anticipations.reduce((sum, a) => sum + (a.net_amount || 0), 0);
        
        // Atualizar datas se antecipações forem mais antigas
        const anticipationDates = anticipations
          .map(a => a.anticipation_date)
          .filter(d => d)
          .sort();
        
        if (anticipationDates.length > 0) {
          const firstAnticipation = anticipationDates[0];
          const lastAnticipation = anticipationDates[anticipationDates.length - 1];
          
          if (!firstPaymentDate || firstAnticipation < firstPaymentDate) {
            firstPaymentDate = firstAnticipation;
          }
          if (!lastPaymentDate || lastAnticipation > lastPaymentDate) {
            lastPaymentDate = lastAnticipation;
          }
        }
      }

      return {
        total_paid: totalPaid > 0 ? totalPaid : null,
        total_anticipated: totalAnticipated > 0 ? totalAnticipated : null,
        first_payment_date: firstPaymentDate,
        last_payment_date: lastPaymentDate
      };

    } catch (error) {
      await this.logger.error('Erro ao buscar dados de pagamento', {
        error: error instanceof Error ? error.message : String(error),
        order_id: orderId
      });
      
      return {
        total_paid: null,
        total_anticipated: null,
        first_payment_date: null,
        last_payment_date: null
      };
    }
  }

  /**
   * Salva ou atualiza o status de conciliação do pedido
   */
  private async upsertOrderStatus(
    orderData: OrderReconciliationData, 
    statusResult: StatusCalculationResult,
    traceId: string
  ) {
    const { error } = await supabase
      .from('ifood_order_reconciliation_status')
      .upsert({
        account_id: orderData.account_id,
        merchant_id: orderData.merchant_id,
        order_id: orderData.order_id,
        order_created_at: orderData.order_created_at,
        gross_from_sales: orderData.gross_from_sales,
        sales_channel: orderData.sales_channel,
        payment_method: orderData.payment_method,
        net_from_reconciliation: orderData.net_from_reconciliation,
        expected_payment_date: orderData.expected_payment_date,
        is_cancelled: orderData.is_cancelled || false,
        total_paid: orderData.total_paid,
        total_anticipated: orderData.total_anticipated,
        first_payment_date: orderData.first_payment_date,
        last_payment_date: orderData.last_payment_date,
        status: statusResult.status,
        divergence_reason: statusResult.divergence_reason,
        divergence_amount: statusResult.divergence_amount,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'account_id,merchant_id,order_id'
      });

    if (error) {
      await this.logger.error('Erro ao salvar status de conciliação', {
        error: error.message,
        order_id: orderData.order_id,
        trace_id: traceId
      });
      throw error;
    }
  }
}
