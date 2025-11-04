// PM2 Ecosystem Config para Contabo
module.exports = {
  apps: [
    {
      name: 'dex-api',
      script: './api/server.ts',
      interpreter: 'node',
      interpreter_args: '-r ts-node/register',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TS_NODE_PROJECT: './tsconfig.json',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000,
    },
  ],
};
