import type { Request, Response } from 'express';
import { addSyncJob, getJobStatus } from '../../../queues/ifood-sales.queue';
import type { SyncJobData } from '../../../types/ifood-sales-sync.types';

/**
 * POST /api/ifood/sales/sync
 * Dispara sync de vendas do iFood
 */
export async function syncIfoodSales(req: Request, res: Response) {
  try {
    const {
      accountId,
      merchantId,
      storeId,
      periodStart,
      periodEnd,
      syncType = 'backfill',
    } = req.body;

    // Validações
    if (!accountId || !merchantId || !storeId || !periodStart || !periodEnd) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios: accountId, merchantId, storeId, periodStart, periodEnd',
      });
    }

    // Validar formato de data (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(periodStart) || !dateRegex.test(periodEnd)) {
      return res.status(400).json({
        error: 'Formato de data inválido. Use YYYY-MM-DD',
      });
    }

    // Criar job data
    const jobData: SyncJobData = {
      accountId,
      merchantId,
      storeId,
      periodStart,
      periodEnd,
      syncType,
      userId: req.headers['x-user-id'] as string,
    };

    // Adicionar job na fila
    const job = await addSyncJob(jobData);

    console.log(`📋 Sync job criado: ${job.id}`);

    return res.status(202).json({
      success: true,
      message: 'Sync iniciado',
      jobId: job.id,
      data: {
        accountId,
        merchantId,
        periodStart,
        periodEnd,
        syncType,
      },
    });

  } catch (error: any) {
    console.error('❌ Erro ao criar sync job:', error);
    return res.status(500).json({
      error: 'Erro ao iniciar sync',
      message: error.message,
    });
  }
}

/**
 * GET /api/ifood/sales/sync/:jobId
 * Consulta status de um sync job
 */
export async function getSyncJobStatus(req: Request, res: Response) {
  try {
    const { jobId } = req.params;

    const status = await getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        error: 'Job não encontrado',
      });
    }

    return res.status(200).json({
      success: true,
      job: status,
    });

  } catch (error: any) {
    console.error('❌ Erro ao consultar status do job:', error);
    return res.status(500).json({
      error: 'Erro ao consultar status',
      message: error.message,
    });
  }
}
