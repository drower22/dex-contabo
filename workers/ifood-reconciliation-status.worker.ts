/**
 * Worker para Cálculo de Status de Conciliação iFood
 * 
 * Executa periodicamente o cálculo de status de conciliação para todas as lojas ativas.
 * Baseado no padrão dos workers existentes (ifood-conciliation.worker.ts)
 */

import { createClient } from '@supabase/supabase-js';
import { IfoodReconciliationCalculator } from '../services/ifood-reconciliation-calculator';
import { logError, logEvent } from '../services/app-logger';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ReconciliationJob {
  id: string;
  account_id: string;
  merchant_id: string;
  job_type: string;
  competence: string | null;
  status: string;
  attempts: number;
  next_retry_at?: string | null;
  trace_id?: string | null;
  run_id?: string | null;
}

function jobLogContext(job?: Partial<ReconciliationJob> | null) {
  return {
    marketplace: 'ifood',
    source: 'dex-contabo/worker',
    service: 'ifood-reconciliation-status-worker',
    trace_id: (job?.trace_id || null) as any,
    run_id: (job?.run_id || null) as any,
    job_id: (job?.id || null) as any,
    account_id: (job?.account_id || null) as any,
    merchant_id: (job?.merchant_id || null) as any,
    job_type: 'reconciliation_status',
    competence: (job?.competence || null) as any,
  };
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
    await logEvent({
      level: 'info',
      ...jobLogContext(null),
      event: 'worker.start',
      message: 'Iniciando worker de status de conciliação',
    });
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.POLL_INTERVAL_MS);
      } catch (error) {
        await logError({
          ...jobLogContext(null),
          event: 'worker.loop.error',
          message: 'Erro no loop principal',
          err: error,
        });
        await this.sleep(this.POLL_INTERVAL_MS);
      }
    }
  }

  /**
   * Para o worker
   */
  stop(): void {
    void logEvent({
      level: 'info',
      ...jobLogContext(null),
      event: 'worker.stop',
      message: 'Parando worker',
    });
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

    await logEvent({
      level: 'info',
      ...jobLogContext(job),
      event: 'ifood.reconciliation_status.process.start',
      message: 'Processando job de reconciliation_status',
    });

    try {
      // Marcar job como running
      await this.updateJobStatus(job.id, 'running');

      // Executar cálculo de conciliação
      await this.calculator.processAccountReconciliation(job.account_id, job.merchant_id);

      // Marcar job como success
      await this.updateJobStatus(job.id, 'success');

      await logEvent({
        level: 'info',
        ...jobLogContext(job),
        event: 'ifood.reconciliation_status.process.success',
        message: 'Job concluído com sucesso',
      });

    } catch (error) {
      await logError({
        ...jobLogContext(job),
        event: 'ifood.reconciliation_status.process.error',
        message: 'Erro ao processar job',
        err: error,
      });

      // Incrementar tentativas e decidir se retry ou fail
      const newAttempts = job.attempts + 1;
      
      if (newAttempts >= this.MAX_ATTEMPTS) {
        await this.updateJobStatus(job.id, 'failed', error instanceof Error ? error.message : String(error));
        await logEvent({
          level: 'warn',
          ...jobLogContext(job),
          event: 'ifood.reconciliation_status.process.failed',
          message: 'Job falhou após max tentativas',
          data: { attempts: newAttempts },
        });
      } else {
        // Liberar job para retry com backoff exponencial
        const backoffMs = Math.pow(2, newAttempts) * 60000; // 2^n minutos em ms
        const nextAttemptAt = new Date(Date.now() + backoffMs);
        
        await this.releaseJobForRetry(job.id, newAttempts, nextAttemptAt);
        await logEvent({
          level: 'info',
          ...jobLogContext(job),
          event: 'ifood.reconciliation_status.process.retry_scheduled',
          message: 'Job liberado para retry',
          data: { attempts: newAttempts, next_retry_at: nextAttemptAt.toISOString() },
        });
      }
    }
  }

  /**
   * Reserva o próximo job disponível
   */
  private async reserveNextJob(): Promise<ReconciliationJob | null> {
    // Buscar jobs pendentes ou que falharam e já podem ser tentados novamente
    const { data, error } = await supabase
      .from('ifood_jobs')
      .select('*')
      .eq('job_type', 'reconciliation_status')
      .eq('status', 'pending')
      .or(`next_retry_at.is.null,next_retry_at.lt.${new Date().toISOString()}`)
      .lt('attempts', this.MAX_ATTEMPTS)
      .order('scheduled_for', { ascending: true })
      .limit(1);

    if (error) {
      await logError({
        ...jobLogContext(null),
        event: 'ifood.jobs.reserve.error',
        message: 'Erro ao buscar jobs',
        err: error,
      });
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
        status: 'running',
        locked_by: 'ifood-reconciliation-status-worker',
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', job.status); // Condição para evitar race condition

    if (updateError) {
      await logError({
        ...jobLogContext(job),
        event: 'ifood.jobs.reserve.error',
        message: 'Erro ao reservar job',
        err: updateError,
      });
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
      locked_at: null,
      locked_by: null,
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
      await logError({
        ...jobLogContext({ id: jobId } as any),
        event: 'ifood.jobs.update_status.error',
        message: 'Erro ao atualizar status do job',
        err: error,
      });
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
        locked_at: null,
        locked_by: null,
        attempts,
        next_retry_at: nextAttemptAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (error) {
      await logError({
        ...jobLogContext({ id: jobId } as any),
        event: 'ifood.jobs.release_retry.error',
        message: 'Erro ao liberar job para retry',
        err: error,
      });
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
    void logEvent({ level: 'info', ...jobLogContext(null), event: 'worker.signal', message: 'Recebido SIGINT, parando worker', data: { signal: 'SIGINT' } });
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    void logEvent({ level: 'info', ...jobLogContext(null), event: 'worker.signal', message: 'Recebido SIGTERM, parando worker', data: { signal: 'SIGTERM' } });
    worker.stop();
    process.exit(0);
  });

  // Iniciar worker
  worker.start().catch(error => {
    void logError({ ...jobLogContext(null), event: 'worker.fatal', message: 'Erro fatal', err: error });
    // eslint-disable-next-line no-console
    console.error('[reconciliation-status-worker] Erro fatal:', error);
    process.exit(1);
  });
}

export { IfoodReconciliationStatusWorker };
