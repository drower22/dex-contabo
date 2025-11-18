import { Queue, QueueEvents } from 'bullmq';
import redis from '../config/redis';
import type { SyncJobData } from '../types/ifood-sales-sync.types';

// Nome da fila
export const QUEUE_NAME = 'ifood-sales-sync';

// Configuração da fila
export const ifoodSalesQueue = new Queue<SyncJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3, // 3 tentativas
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      count: 100, // Manter últimos 100 jobs completos
      age: 24 * 3600, // Remover após 24h
    },
    removeOnFail: {
      count: 500, // Manter últimos 500 jobs com falha
    },
  },
});

// Events para monitorar a fila
export const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: redis,
});

// Logs de eventos
queueEvents.on('completed', ({ jobId }: { jobId: string }) => {
  console.log(`✅ Job ${jobId} completado`);
});

queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
  console.error(`❌ Job ${jobId} falhou:`, failedReason);
});

queueEvents.on('progress', ({ jobId, data }: { jobId: string; data: any }) => {
  console.log(`⏳ Job ${jobId} progresso:`, data);
});

// Função helper para adicionar job na fila
export async function addSyncJob(data: SyncJobData) {
  const job = await ifoodSalesQueue.add('sync-sales', data, {
    jobId: `${data.accountId}-${data.merchantId}-${data.periodStart}-${data.periodEnd}`, // ID único
    priority: data.syncType === 'daily' ? 1 : 2, // Daily tem prioridade
  });

  console.log(`📋 Job adicionado: ${job.id}`);
  return job;
}

// Função para obter status de um job
export async function getJobStatus(jobId: string) {
  const job = await ifoodSalesQueue.getJob(jobId);
  
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;
  
  return {
    id: job.id,
    state,
    progress,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
  };
}

// Função para limpar jobs antigos
export async function cleanOldJobs() {
  await ifoodSalesQueue.clean(7 * 24 * 3600 * 1000, 1000, 'completed'); // 7 dias
  await ifoodSalesQueue.clean(30 * 24 * 3600 * 1000, 1000, 'failed'); // 30 dias
  console.log('🧹 Jobs antigos limpos');
}

export default ifoodSalesQueue;
