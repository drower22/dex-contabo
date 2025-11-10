module.exports = {
  apps: [
    {
      name: 'dex-api',
      script: 'api/server.ts',
      interpreter: 'ts-node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'dex-cron-refresh',
      script: 'node',
      args: '-e "require(\'node-fetch\').default(\'http://localhost:3000/api/cron/refresh-tokens\', {method: \'POST\', headers: {\'Authorization\': \'Bearer \' + process.env.CRON_SECRET, \'Content-Type\': \'application/json\'}})"',
      cron_restart: '*/30 * * * *', // A cada 30 minutos
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
