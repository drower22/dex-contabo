// Endpoint de status do iFood Auth (versão JavaScript)
const { createClient } = require('@supabase/supabase-js');

module.exports = async function statusHandler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { accountId, scope } = req.query;

  if (!accountId) {
    return res.status(400).json({ status: 'error', message: 'Missing accountId' });
  }

  if (scope !== 'reviews' && scope !== 'financial') {
    return res.status(400).json({ status: 'error', message: 'Invalid scope' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Buscar registro
    const { data: row, error: selErr } = await supabase
      .from('ifood_store_auth')
      .select('account_id, scope, access_token, refresh_token, ifood_merchant_id, status')
      .eq('account_id', accountId)
      .eq('scope', scope)
      .maybeSingle();

    if (selErr) {
      console.error('[status] Database error:', selErr);
      return res.status(500).json({ status: 'error', message: 'Database query failed' });
    }

    if (!row || !row.access_token) {
      // Criar registro pending se não existir
      await supabase.from('ifood_store_auth').upsert(
        { account_id: accountId, scope, status: 'pending' },
        { onConflict: 'account_id,scope' }
      );
      return res.json({ status: 'pending', message: 'No authentication record found' });
    }

    // Se já tem status salvo, retornar
    if (row.status === 'connected') {
      return res.json({
        status: 'connected',
        merchantId: row.ifood_merchant_id || null,
      });
    }

    // Retornar status atual
    return res.json({
      status: row.status || 'pending',
      merchantId: row.ifood_merchant_id || null,
    });
  } catch (error) {
    console.error('[status] Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
