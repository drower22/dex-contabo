// Endpoint para gerar link code (device authorization flow)
const crypto = require('crypto');

module.exports = async function linkHandler(req, res) {
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
  const { storeId, merchantId } = req.body;

  if (!merchantId && !storeId) {
    return res.status(400).json({ error: 'Missing merchantId or storeId' });
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
      console.error('[link] Missing iFood credentials for scope:', scope);
      return res.status(500).json({ error: 'iFood credentials not configured' });
    }

    // Gerar code_verifier (PKCE)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    
    // Gerar code_challenge
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Chamar API do iFood para device authorization
    const ifoodApiUrl = process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br';
    const authUrl = `${ifoodApiUrl}/oauth/device/authorization`;

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[link] iFood API error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: 'Failed to generate link code',
        details: errorText 
      });
    }

    const data = await response.json();

    // Retornar dados do device authorization + code_verifier
    return res.json({
      userCode: data.user_code,
      authorizationCodeVerifier: codeVerifier,
      verificationUrl: data.verification_url,
      verificationUrlComplete: data.verification_url_complete,
      linkCode: data.device_code, // Guardar para possível uso futuro
    });
  } catch (error) {
    console.error('[link] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
