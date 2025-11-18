import { Worker, Job } from 'bullmq';
import redis from '../config/redis';
import { QUEUE_NAME } from '../queues/ifood-sales.queue';
import type { SyncJobData, SyncJobProgress } from '../types/ifood-sales-sync.types';
import {
  createSyncStatus,
  updateSyncStatus,
  fetchIfoodSales,
  saveSalesToSupabase,
  logToSupabase,
  getIfoodToken,
} from '../services/ifood-sales-sync.service';

/**
 * Processa um job de sync de vendas
 */
async function processSyncJob(job: Job<SyncJobData>) {
  const { accountId, merchantId, storeId, periodStart, periodEnd, syncType } = job.data;

  console.log(`🚀 Iniciando sync: ${accountId} - ${merchantId} (${periodStart} a ${periodEnd})`);

  // 1. Criar registro de sync status
  const syncId = await createSyncStatus(job.data);

  try {
    // 2. Atualizar status para "running"
    await updateSyncStatus(syncId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    await logToSupabase('info', `Sync iniciado: ${merchantId}`, accountId, {
      syncId,
      periodStart,
      periodEnd,
      syncType,
    });

    // 3. Obter token do iFood
    console.log(`🔑 Obtendo token para store ${storeId}...`);
    const token = await getIfoodToken(storeId);

    // 4. Buscar vendas página por página
    let currentPage = 1;
    let totalSales = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`📄 Buscando página ${currentPage}...`);

      // Buscar vendas da página atual
      const { sales, hasMore: morePages } = await fetchIfoodSales(
        token,
        merchantId,
        periodStart,
        periodEnd,
        currentPage
      );

      hasMore = morePages;

      if (sales.length > 0) {
        // Salvar vendas no Supabase
        const savedCount = await saveSalesToSupabase(sales, accountId);
        totalSales += savedCount;

        console.log(`💾 Página ${currentPage}: ${savedCount} vendas salvas (total: ${totalSales})`);

        // Atualizar progresso
        const progress: SyncJobProgress = {
          currentPage,
          totalPages: currentPage,
          totalSales,
          processedSales: totalSales,
          status: 'running',
        };

        await job.updateProgress(progress);

        // Atualizar sync status
        await updateSyncStatus(syncId, {
          totalSales,
          totalPages: currentPage,
        });
      }

      currentPage++;

      // Rate limiting: aguardar 100ms entre páginas
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 5. Finalizar sync
    await updateSyncStatus(syncId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      totalSales,
      totalPages: currentPage - 1,
    });

    await logToSupabase('info', `Sync concluído: ${merchantId}`, accountId, {
      syncId,
      totalSales,
      totalPages: currentPage - 1,
    });

    console.log(`✅ Sync concluído: ${totalSales} vendas processadas em ${currentPage - 1} páginas`);

    return {
      success: true,
      totalSales,
      totalPages: currentPage - 1,
    };

  } catch (error: any) {
    console.error(`❌ Erro no sync:`, error);

    // Atualizar status para "failed"
    await updateSyncStatus(syncId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      lastError: error.message,
    });

    await logToSupabase('error', `Erro no sync: ${error.message}`, accountId, {
      syncId,
      error: error.stack,
    });

    throw error;
  }
}

// Criar worker
const worker = new Worker<SyncJobData>(
  QUEUE_NAME,
  processSyncJob,
  {
    connection: redis,
    concurrency: 10, // Processar 10 jobs simultaneamente
    limiter: {
      max: 100, // Máximo 100 jobs
      duration: 60000, // Por minuto
    },
  }
);

// Eventos do worker
worker.on('completed', (job: Job<SyncJobData>) => {
  console.log(`✅ Worker completou job ${job.id}`);
});

worker.on('failed', (job: Job<SyncJobData> | undefined, err: Error) => {
  console.error(`❌ Worker falhou job ${job?.id}:`, err.message);
});

worker.on('error', (err: Error) => {
  console.error('❌ Erro no worker:', err);
});

console.log('👷 Worker de sync de vendas iniciado');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Encerrando worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Encerrando worker...');
  await worker.close();
  process.exit(0);
});

export default worker;
