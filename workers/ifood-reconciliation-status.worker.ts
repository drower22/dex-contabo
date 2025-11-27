/**
 * Worker para Cálculo de Status de Conciliação iFood
 * 
 * Executa periodicamente o cálculo de status de conciliação para todas as lojas ativas.
 * Baseado no padrão dos workers existentes (ifood-conciliation.worker.ts)
 */

import { createClient } from '@supabase/supabase-js';
import { IfoodReconciliationCalculator } from '../services/ifood-reconciliation-calculator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ReconciliationJob {
  id: string;
  account_id: string;
  merchant_id: string;
  job_type: string;
  competence: string;
  status: string;
  reserved_at: string | null;
  attempts: number;
  created_at: string;
}

class IfoodReconciliationStatusWorker {
  private calculator: IfoodReconciliationCalculator;
  private isRunning: boolean = false;
  private readonly MAX_ATTEMPTS = 3;
  private readonly RESERVE_TIMEOUT_MINUTES = 30;
  private readonly POLL_INTERVAL_MS = 10000; // 10 segundos

  constructor() {
    this.calculator = new IfoodReconciliationCalculator();
  }

  /**
   * Inicia o worker
   */
  async start(): Promise<void> {
    console.log('[reconciliation-status-worker] Iniciando worker de status de conciliação...');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.POLL_INTERVAL_MS);
      } catch (error) {
        console.error('[reconciliation-status-worker] Erro no loop principal:', error);
        await this.sleep(this.POLL_INTERVAL_MS);
      }
    }
  }

  /**
   * Para o worker
   */
  stop(): void {
    console.log('[reconciliation-status-worker] Parando worker...');
    this.isRunning = false;
  }

  /**
   * Processa o próximo job disponível
   */
  private async processNextJob(): Promise<void> {
    const job = await this.reserveNextJob();
    if (!job) {
      return; // Nenhum job disponível
    }

    console.log(`[reconciliation-status-worker] Processando job ${job.id} para account ${job.account_id}`);

    try {
      // Marcar job como running
      await this.updateJobStatus(job.id, 'running');

      // Executar cálculo de conciliação
      await this.calculator.processAccountReconciliation(job.account_id, job.merchant_id);

      // Marcar job como success
      await this.updateJobStatus(job.id, 'success');

      console.log(`[reconciliation-status-worker] Job ${job.id} concluído com sucesso`);

    } catch (error) {
      console.error(`[reconciliation-status-worker] Erro ao processar job ${job.id}:`, error);

      // Incrementar tentativas e decidir se retry ou fail
      const newAttempts = job.attempts + 1;
      
      if (newAttempts >= this.MAX_ATTEMPTS) {
        await this.updateJobStatus(job.id, 'failed', error instanceof Error ? error.message : String(error));
        console.log(`[reconciliation-status-worker] Job ${job.id} falhou após ${this.MAX_ATTEMPTS} tentativas`);
      } else {
        // Liberar job para retry com backoff exponencial
        const backoffMs = Math.pow(2, newAttempts) * 60000; // 2^n minutos em ms
        const nextAttemptAt = new Date(Date.now() + backoffMs);
        
        await this.releaseJobForRetry(job.id, newAttempts, nextAttemptAt);
        console.log(`[reconciliation-status-worker] Job ${job.id} liberado para retry em ${nextAttemptAt.toISOString()}`);
      }
    }
  }

  /**
   * Reserva o próximo job disponível
   */
  private async reserveNextJob(): Promise<ReconciliationJob | null> {
    const reserveUntil = new Date(Date.now() + this.RESERVE_TIMEOUT_MINUTES * 60000);

    // Buscar jobs pendentes ou que falharam e já podem ser tentados novamente
    const { data, error } = await supabase
      .from('ifood_jobs')
      .select('*')
      .eq('job_type', 'reconciliation_status')
      .in('status', ['pending', 'failed'])
      .or(`reserved_at.is.null,reserved_at.lt.${new Date().toISOString()}`)
      .lt('attempts', this.MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[reconciliation-status-worker] Erro ao buscar jobs:', error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const job = data[0];

    // Tentar reservar o job
    const { error: updateError } = await supabase
      .from('ifood_jobs')
      .update({
        reserved_at: reserveUntil.toISOString(),
        status: 'reserved'
      })
      .eq('id', job.id)
      .eq('status', job.status); // Condição para evitar race condition

    if (updateError) {
      console.error('[reconciliation-status-worker] Erro ao reservar job:', updateError);
      return null;
    }

    return job;
  }

  /**
   * Atualiza o status de um job
   */
  private async updateJobStatus(jobId: string, status: string, errorMessage?: string): Promise<void> {
    const updateData: any = {
      status,
      reserved_at: null,
      updated_at: new Date().toISOString()
    };

    if (errorMessage) {
      updateData.last_error = errorMessage;
    }

    if (status === 'success') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('ifood_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (error) {
      console.error(`[reconciliation-status-worker] Erro ao atualizar status do job ${jobId}:`, error);
    }
  }

  /**
   * Libera um job para retry
   */
  private async releaseJobForRetry(jobId: string, attempts: number, nextAttemptAt: Date): Promise<void> {
    const { error } = await supabase
      .from('ifood_jobs')
      .update({
        status: 'pending',
        reserved_at: null,
        attempts,
        next_attempt_at: nextAttemptAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (error) {
      console.error(`[reconciliation-status-worker] Erro ao liberar job ${jobId} para retry:`, error);
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Executar worker se chamado diretamente
if (require.main === module) {
  const worker = new IfoodReconciliationStatusWorker();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[reconciliation-status-worker] Recebido SIGINT, parando worker...');
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[reconciliation-status-worker] Recebido SIGTERM, parando worker...');
    worker.stop();
    process.exit(0);
  });

  // Iniciar worker
  worker.start().catch(error => {
    console.error('[reconciliation-status-worker] Erro fatal:', error);
    process.exit(1);
  });
}

export { IfoodReconciliationStatusWorker };
