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

    // Worker de Sync de Vendas iFood
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // Supabase
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_KEY: process.env.SUPABASE_KEY,
        // Redis
        REDIS_HOST: process.env.REDIS_HOST || 'localhost',
        REDIS_PORT: process.env.REDIS_PORT || '6379',
        // iFood Proxy
        IFOOD_PROXY_BASE: process.env.IFOOD_PROXY_BASE,
        IFOOD_PROXY_KEY: process.env.IFOOD_PROXY_KEY,
        SHARED_PROXY_KEY: process.env.SHARED_PROXY_KEY,
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
  ],
};
