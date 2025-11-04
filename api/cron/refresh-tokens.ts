/**
 * @file api/cron/refresh-tokens.ts
 * @description Cron job para renovar tokens que estão prestes a expirar
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { notifyWarning, notifySuccess } from '../_shared/discord';
import { log } from '../_shared/logger';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validar secret do cron
  const authHeader = req.headers['authorization'];
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedAuth) {
    log.warn('Unauthorized cron access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  log.info('Starting token refresh cron job');

  try {
    // Buscar tokens que expiram em < 1 hora
    const oneHourFromNow = new Date(Date.now() + 3600000).toISOString();
    const now = new Date().toISOString();

    const { data: expiring, error } = await supabase
      .from('ifood_store_auth')
      .select('account_id, scope, ifood_merchant_id, expires_at')
      .eq('status', 'connected')
      .gt('expires_at', now)
      .lt('expires_at', oneHourFromNow);

    if (error) {
      throw error;
    }

    if (!expiring || expiring.length === 0) {
      log.info('No tokens expiring soon');
      return res.json({
        message: 'No tokens to refresh',
        processed: 0,
      });
    }

    log.info(`Found ${expiring.length} tokens expiring soon`);

    const results = [];
    const baseUrl = process.env.BASE_URL || 'https://dex-contabo.vercel.app';

    for (const auth of expiring) {
      try {
        const resp = await fetch(`${baseUrl}/api/ifood-auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: auth.scope,
            storeId: auth.ifood_merchant_id || auth.account_id,
          }),
        });

        const success = resp.ok;
        results.push({
          account_id: auth.account_id,
          scope: auth.scope,
          success,
          status: resp.status,
        });

        if (!success) {
          log.warn('Failed to refresh token', {
            accountId: auth.account_id,
            scope: auth.scope,
            status: resp.status,
          });
        }
      } catch (error) {
        results.push({
          account_id: auth.account_id,
          scope: auth.scope,
          success: false,
          error: (error as Error).message,
        });

        log.error('Error refreshing token', {
          accountId: auth.account_id,
          scope: auth.scope,
          error: (error as Error).message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    // Notificar no Discord
    if (failureCount > 0) {
      await notifyWarning(
        `Token refresh: ${successCount} sucesso, ${failureCount} falhas`,
        {
          total: results.length,
          success: successCount,
          failures: failureCount,
        }
      );
    } else {
      await notifySuccess(`${successCount} tokens renovados com sucesso`, {
        total: results.length,
      });
    }

    log.info('Token refresh cron completed', {
      total: results.length,
      success: successCount,
      failures: failureCount,
    });

    return res.json({
      message: 'Token refresh completed',
      processed: results.length,
      success: successCount,
      failures: failureCount,
      results,
    });
  } catch (error) {
    log.error('Cron job failed', {
      error: (error as Error).message,
    });

    await notifyWarning('Cron job de refresh falhou', {
      error: (error as Error).message,
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
  }
}
