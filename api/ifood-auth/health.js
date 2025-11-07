/**
 * @file api/ifood-auth/health.js
 * @description Health check endpoint que valida todas as dependências
 * Versão JavaScript puro (convertido de TypeScript)
 */
const { createClient } = require('@supabase/supabase-js');
const { encryptToB64, decryptFromB64 } = require('../_shared/crypto');
const { notifyWarning } = require('../_shared/discord');

const IFOOD_BASE_URL = (
  process.env.IFOOD_BASE_URL ||
  process.env.IFOOD_API_URL ||
  'https://merchant-api.ifood.com.br'
).trim();

/**
 * Health check handler
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const checks = {
    supabase: false,
    encryption: false,
    ifood_reviews: false,
    ifood_financial: false,
  };

  const errors = [];

  // 1. Check Supabase
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    await supabase.from('accounts').select('id').limit(1);
    checks.supabase = true;
  } catch (error) {
    errors.push(`Supabase: ${error.message}`);
  }

  // 2. Check Encryption
  try {
    const test = await encryptToB64('test-token');
    const decrypted = await decryptFromB64(test);
    checks.encryption = decrypted === 'test-token';
    if (!checks.encryption) {
      errors.push('Encryption: Decryption mismatch');
    }
  } catch (error) {
    errors.push(`Encryption: ${error.message}`);
  }

  // 3. Check iFood Reviews credentials
  try {
    const clientId =
      process.env.IFOOD_CLIENT_ID_REVIEWS || process.env.IFOOD_CLIENT_ID;
    if (clientId) {
      const resp = await fetch(`${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ clientId }),
      });
      // 200 ou 400 = credenciais válidas (400 = request inválido mas auth ok)
      checks.ifood_reviews = resp.ok || resp.status === 400;
      if (!checks.ifood_reviews) {
        errors.push(`iFood Reviews: HTTP ${resp.status}`);
      }
    } else {
      errors.push('iFood Reviews: CLIENT_ID not configured');
    }
  } catch (error) {
    errors.push(`iFood Reviews: ${error.message}`);
  }

  // 4. Check iFood Financial credentials
  try {
    const clientId = process.env.IFOOD_CLIENT_ID_FINANCIAL;
    if (clientId) {
      const resp = await fetch(`${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ clientId }),
      });
      checks.ifood_financial = resp.ok || resp.status === 400;
      if (!checks.ifood_financial) {
        errors.push(`iFood Financial: HTTP ${resp.status}`);
      }
    } else {
      // Financial é opcional
      checks.ifood_financial = true;
    }
  } catch (error) {
    errors.push(`iFood Financial: ${error.message}`);
  }

  const allOk = Object.values(checks).every(v => v);

  // Notifica no Discord se houver problemas
  if (!allOk) {
    await notifyWarning('Health check falhou', {
      checks: JSON.stringify(checks),
      errors: errors.join('; '),
    });
  }

  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'unhealthy',
    checks,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'development',
  });
}

module.exports = handler;
