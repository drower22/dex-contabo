// Endpoint para renovar access token usando refresh token
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Função para descriptografar tokens
function decrypt(text, key) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Função para criptografar tokens
function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

module.exports = async function refreshHandler(req, res) {
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
  const { storeId } = req.body;

  if (!storeId) {
    return res.status(400).json({ error: 'Missing storeId' });
  }

  // Validar scope
  if (scope && scope !== 'reviews' && scope !== 'financial') {
    return res.status(400).json({ error: 'Invalid scope. Must be "reviews" or "financial"' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Buscar refresh token do banco
    const { data: authData, error: authError } = await supabase
      .from('ifood_store_auth')
      .select('refresh_token, scope')
      .eq('account_id', storeId)
      .eq('scope', scope || 'default')
      .single();

    if (authError || !authData || !authData.refresh_token) {
      console.error('[refresh] No refresh token found:', authError);
      return res.status(404).json({ error: 'No refresh token found for this store' });
    }

    // Descriptografar refresh token
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length !== 64) {
      console.error('[refresh] Invalid ENCRYPTION_KEY');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const refreshToken = decrypt(authData.refresh_token, encryptionKey);

    // Determinar clientId e clientSecret baseado no scope
    let clientId, clientSecret;
    const effectiveScope = scope || authData.scope;
    
    if (effectiveScope === 'reviews') {
      clientId = process.env.IFOOD_CLIENT_ID_REVIEWS || process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET_REVIEWS || process.env.IFOOD_CLIENT_SECRET;
    } else if (effectiveScope === 'financial') {
      clientId = process.env.IFOOD_CLIENT_ID_FINANCIAL || process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET_FINANCIAL || process.env.IFOOD_CLIENT_SECRET;
    } else {
      clientId = process.env.IFOOD_CLIENT_ID;
      clientSecret = process.env.IFOOD_CLIENT_SECRET;
    }

    if (!clientId || !clientSecret) {
      console.error('[refresh] Missing iFood credentials for scope:', effectiveScope);
      return res.status(500).json({ error: 'iFood credentials not configured' });
    }

    // Renovar token na API do iFood
    const ifoodApiUrl = process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br';
    const tokenUrl = `${ifoodApiUrl}/oauth/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[refresh] iFood API error:', response.status, errorText);
      
      // Se o refresh token expirou, marcar como pendente
      if (response.status === 400 || response.status === 401) {
        await supabase
          .from('ifood_store_auth')
          .update({ status: 'pending' })
          .eq('account_id', storeId)
          .eq('scope', scope || 'default');
      }
      
      return res.status(response.status).json({ 
        error: 'Failed to refresh token',
        details: errorText 
      });
    }

    const tokens = await response.json();

    // Criptografar novos tokens
    const encryptedAccessToken = encrypt(tokens.access_token, encryptionKey);
    const encryptedRefreshToken = encrypt(tokens.refresh_token, encryptionKey);

    // Atualizar tokens no banco
    const { error: updateError } = await supabase
      .from('ifood_store_auth')
      .update({
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
        status: 'connected',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', storeId)
      .eq('scope', scope || 'default');

    if (updateError) {
      console.error('[refresh] Failed to update tokens:', updateError);
      return res.status(500).json({ error: 'Failed to update tokens' });
    }

    // Retornar novos tokens
    return res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });
  } catch (error) {
    console.error('[refresh] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
