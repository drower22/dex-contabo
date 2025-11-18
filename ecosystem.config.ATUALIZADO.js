// ============================================================
// ECOSYSTEM.CONFIG.JS ATUALIZADO COM WORKER
// ============================================================
// Este é o seu ecosystem.config.js ATUALIZADO com o worker adicionado
// Copie este arquivo para o Contabo e substitua o atual

module.exports = {
  apps: [
    // API Principal (existente)
    {
      name: 'dex-api',
      script: './node_modules/.bin/ts-node',
      args: 'api/server.ts',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      error_file: '/root/.pm2/logs/dex-api-error.log',
      out_file: '/root/.pm2/logs/dex-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    },

    // Worker de Sync de Vendas iFood (NOVO)
    {
      name: 'ifood-sales-worker',
      script: 'dist/workers/ifood-sales-sync.worker.js',
      cwd: '/home/dex/dex-app',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/root/.pm2/logs/worker-error.log',
      out_file: '/root/.pm2/logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      restart_delay: 5000,
    },
  ]
};
