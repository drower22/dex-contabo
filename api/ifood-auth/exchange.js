// Endpoint para trocar authorization code por tokens
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Função para criptografar tokens
function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

module.exports = async function exchangeHandler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { scope } = req.query;
  const { storeId, authorizationCode, authorizationCodeVerifier } = req.body;

  if (!storeId || !authorizationCode || !authorizationCodeVerifier) {
    return res.status(400).json({ 
      error: 'Missing required fields: storeId, authorizationCode, authorizationCodeVerifier' 
    });
  }

  // Validar scope
  if (scope && scope !== 'reviews' && scope !== 'financial') {
    return res.status(400).json({ error: 'Invalid scope. Must be "reviews" or "financial"' });
  }

  try {
    // Determinar clientId e clientSecret baseado no scope
    let clientId, clientSecret;
    
    if (scope === 'reviews') {
      clientId = process.env.IFOOD_CLIENT_ID_REVIEWS || process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET_REVIEWS || process.env.IFOOD_CLIENT_SECRET;
    } else if (scope === 'financial') {
      clientId = process.env.IFOOD_CLIENT_ID_FINANCIAL || process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET_FINANCIAL || process.env.IFOOD_CLIENT_SECRET;
    } else {
      // Fallback para credenciais padrão
      clientId = process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET;
    }

    if (!clientId || !clientSecret) {
      console.error('[exchange] Missing iFood credentials for scope:', scope);
      return res.status(500).json({ error: 'iFood credentials not configured' });
    }

    // Trocar authorization code por tokens na API do iFood
    const ifoodApiUrl = process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br';
    const tokenUrl = `${ifoodApiUrl}/oauth/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        code_verifier: authorizationCodeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[exchange] iFood API error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: 'Failed to exchange authorization code',
        details: errorText 
      });
    }

    const tokens = await response.json();

    // Buscar merchantId da conta
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('ifood_merchant_id')
      .eq('id', storeId)
      .single();

    if (accountError) {
      console.error('[exchange] Failed to fetch account:', accountError);
    }

    const merchantId = account?.ifood_merchant_id || null;

    // Criptografar tokens antes de salvar
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length !== 64) {
      console.error('[exchange] Invalid ENCRYPTION_KEY');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const encryptedAccessToken = encrypt(tokens.access_token, encryptionKey);
    const encryptedRefreshToken = encrypt(tokens.refresh_token, encryptionKey);

    // Salvar tokens no Supabase
    const { error: upsertError } = await supabase
      .from('ifood_store_auth')
      .upsert({
        account_id: storeId,
        scope: scope || 'default',
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
        ifood_merchant_id: merchantId,
        status: 'connected',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'account_id,scope',
      });

    if (upsertError) {
      console.error('[exchange] Failed to save tokens:', upsertError);
      return res.status(500).json({ error: 'Failed to save tokens' });
    }

    // Retornar tokens (não criptografados para o frontend usar imediatamente)
    return res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });
  } catch (error) {
    console.error('[exchange] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
