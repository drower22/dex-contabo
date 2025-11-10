/**
 * @file api/ifood-auth/debug-env.ts
 * @description Endpoint para verificar variáveis de ambiente (REMOVER EM PRODUÇÃO!)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verificar variáveis críticas (sem expor valores completos)
  const envCheck = {
    supabase: {
      url: !!process.env.SUPABASE_URL,
      serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    ifood: {
      baseUrl: process.env.IFOOD_BASE_URL || 'default',
      clientId: !!process.env.IFOOD_CLIENT_ID,
      clientSecret: !!process.env.IFOOD_CLIENT_SECRET,
      clientIdReviews: !!process.env.IFOOD_CLIENT_ID_REVIEWS,
      clientSecretReviews: !!process.env.IFOOD_CLIENT_SECRET_REVIEWS,
      clientIdFinancial: !!process.env.IFOOD_CLIENT_ID_FINANCIAL,
      clientSecretFinancial: !!process.env.IFOOD_CLIENT_SECRET_FINANCIAL,
    },
    crypto: {
      encryptionKey: !!process.env.ENCRYPTION_KEY,
    },
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
  };

  return res.status(200).json({
    message: 'Environment check',
    env: envCheck,
    warnings: [
      !envCheck.ifood.clientIdFinancial && 'Missing IFOOD_CLIENT_ID_FINANCIAL',
      !envCheck.ifood.clientSecretFinancial && 'Missing IFOOD_CLIENT_SECRET_FINANCIAL',
      !envCheck.crypto.encryptionKey && 'Missing ENCRYPTION_KEY',
    ].filter(Boolean),
  });
}
