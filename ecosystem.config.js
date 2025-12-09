// ⚠️ ATENÇÃO: Este é um EXEMPLO de ecosystem.config.js
// Se você já tem um ecosystem.config.js no Contabo, NÃO substitua!
// Em vez disso, adicione apenas a configuração do worker abaixo ao seu arquivo existente.

// ============================================================
// CONFIGURAÇÃO DO WORKER PARA ADICIONAR AO SEU ECOSYSTEM
// ============================================================
// Copie apenas este bloco e adicione ao array "apps" do seu ecosystem.config.js existente:

/*
{
  name: 'ifood-sales-worker',
  script: 'dist/workers/ifood-sales-sync.worker.js',
  instances: 1,
  exec_mode: 'fork',
  env: {
    NODE_ENV: 'production',
  },
  error_file: './logs/worker-error.log',
  out_file: './logs/worker-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
  autorestart: true,
  watch: false,
  max_memory_restart: '512M',
  restart_delay: 5000,
  max_restarts: 10,
  min_uptime: '10s',
},
*/

// ============================================================
// EXEMPLO COMPLETO (caso não tenha ecosystem.config.js)
// ============================================================

module.exports = {
  apps: [
    // API Principal
    {
      name: 'dex-api',
      script: 'dist/api/server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    },

    // Worker de Sync de Vendas iFood (fila ifood_jobs)
    {
      name: 'ifood-sales_worker',
      script: './node_modules/.bin/ts-node',
      args: 'workers/ifood-sales.worker.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        DEX_API_BASE_URL: 'http://localhost:3000',
        IFOOD_WORKER_MAX_CONCURRENCY: '5',
        IFOOD_WORKER_POLL_INTERVAL_MS: '10000',
        IFOOD_WORKER_MAX_ATTEMPTS: '3',
      },
      error_file: './logs/worker-sales-error.log',
      out_file: './logs/worker-sales-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },

    // Worker de Jobs de Conciliação iFood (fila ifood_jobs)
    {
      name: 'ifood-conciliation_worker',
      script: './node_modules/.bin/ts-node',
      args: 'workers/ifood-conciliation.worker.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        DEX_API_BASE_URL: 'http://localhost:3000',
        IFOOD_WORKER_MAX_CONCURRENCY: '5',
        IFOOD_WORKER_POLL_INTERVAL_MS: '10000',
        IFOOD_WORKER_MAX_ATTEMPTS: '3',
      },
      error_file: './logs/worker-ifood-error.log',
      out_file: './logs/worker-ifood-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },

    // Worker de Repasses Semanais iFood (fila ifood_jobs, job_type = settlements_weekly)
    {
      name: 'ifood-settlements_worker',
      script: './node_modules/.bin/ts-node',
      args: 'workers/ifood-settlements.worker.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        DEX_API_BASE_URL: 'http://localhost:3000',
        IFOOD_WORKER_MAX_CONCURRENCY: '5',
        IFOOD_WORKER_POLL_INTERVAL_MS: '10000',
        IFOOD_WORKER_MAX_ATTEMPTS: '3',
      },
      error_file: './logs/worker-settlements-error.log',
      out_file: './logs/worker-settlements-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },

    // Worker de Status de Conciliação iFood (fila ifood_jobs)
    {
      name: 'ifood-reconciliation-status_worker',
      script: './node_modules/.bin/ts-node',
      args: 'workers/ifood-reconciliation-status.worker.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        DEX_API_BASE_URL: 'http://localhost:3000',
        IFOOD_WORKER_MAX_CONCURRENCY: '5',
        IFOOD_WORKER_POLL_INTERVAL_MS: '10000',
        IFOOD_WORKER_MAX_ATTEMPTS: '3',
      },
      error_file: './logs/worker-reconciliation-status-error.log',
      out_file: './logs/worker-reconciliation-status-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
