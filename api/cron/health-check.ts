/**
 * @file api/cron/health-check.ts
 * @description Cron job para monitorar saúde do sistema a cada 15 minutos
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notifyError } from '../_shared/discord';
import { log } from '../_shared/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validar secret do cron
  const authHeader = req.headers['authorization'];
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedAuth) {
    log.warn('Unauthorized cron access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  log.info('Starting health check cron job');

  try {
    const baseUrl = process.env.BASE_URL || 'https://dex-contabo.vercel.app';

    // Chamar endpoint de health
    const response = await fetch(`${baseUrl}/api/ifood-auth/health`, {
      method: 'GET',
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'healthy') {
      // Sistema não está saudável, notificar
      await notifyError('Sistema não está saudável', {
        status: data.status,
        checks: JSON.stringify(data.checks),
        errors: data.errors?.join('; ') || 'Unknown',
      });

      log.error('Health check failed', {
        status: data.status,
        checks: data.checks,
      });

      return res.status(503).json({
        message: 'System unhealthy',
        details: data,
      });
    }

    log.info('Health check passed');

    return res.json({
      message: 'System healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Health check cron failed', {
      error: (error as Error).message,
    });

    await notifyError(error as Error, {
      cron: 'health-check',
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
  }
}
