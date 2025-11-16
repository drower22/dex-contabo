import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { withCors } from '../_shared/cors';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials for link.save handler');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const linkSaveHandler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { accountId, scope, userCode, authorizationCodeVerifier, merchantId } = req.body || {};

  const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log('[ifood-auth/link.save] ⇢ start', {
    traceId,
    accountId,
    scope,
    hasUserCode: !!userCode,
    hasVerifier: !!authorizationCodeVerifier,
    merchantId: merchantId || null,
  });

  if (!accountId || typeof accountId !== 'string') {
    res.status(400).json({ error: 'accountId é obrigatório' });
    return;
  }

  const scopeValue = scope === 'financial' || scope === 'reviews' ? scope : undefined;
  if (!scopeValue) {
    res.status(400).json({ error: 'Scope inválido. Use financial ou reviews.' });
    return;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(accountId)) {
    res.status(400).json({ error: 'accountId deve ser um UUID válido' });
    return;
  }

  if (!userCode || typeof userCode !== 'string') {
    res.status(400).json({ error: 'userCode é obrigatório' });
    return;
  }

  if (!authorizationCodeVerifier || typeof authorizationCodeVerifier !== 'string') {
    res.status(400).json({ error: 'authorizationCodeVerifier é obrigatório' });
    return;
  }

  try {
    // Preparar dados para upsert (incluir merchantId se fornecido)
    const upsertData: any = {
      account_id: accountId,
      scope: scopeValue,
      link_code: userCode,
      verifier: authorizationCodeVerifier,
      status: 'pending',
    };
    
    // Adicionar merchantId se fornecido pelo usuário no modal
    if (merchantId && typeof merchantId === 'string' && merchantId.trim()) {
      upsertData.ifood_merchant_id = merchantId.trim();
      console.log('[ifood-auth/link.save] 💾 Salvando merchantId fornecido pelo usuário:', merchantId.trim());
    }
    
    const { error: saveError } = await supabase
      .from('ifood_store_auth')
      .upsert(upsertData, { onConflict: 'account_id,scope' });

    if (saveError) {
      console.error('[ifood-auth/link.save] ❌ Error saving to database', { traceId, saveError });
      res.status(500).json({ error: 'Falha ao salvar no banco de dados', details: saveError.message });
      return;
    }

    console.log('[ifood-auth/link.save] ✅ Link stored successfully', { traceId, accountId, scope: scopeValue });

    // Atualizar também a tabela accounts com o merchantId
    if (merchantId && typeof merchantId === 'string' && merchantId.trim()) {
      const { error: updateAccountError } = await supabase
        .from('accounts')
        .update({ ifood_merchant_id: merchantId.trim() })
        .eq('id', accountId);
      
      if (updateAccountError) {
        console.warn('[ifood-auth/link.save] ⚠️ Failed to update accounts table:', updateAccountError);
      } else {
        console.log('[ifood-auth/link.save] ✅ accounts.ifood_merchant_id updated');
      }
    }

    res.status(200).json({
      ok: true,
      account_id: accountId,
      scope: scopeValue,
    });
  } catch (error: any) {
    console.error('[ifood-auth/link.save] error', {
      traceId,
      message: error?.message,
      stack: error?.stack,
    });

    res.status(500).json({
      error: 'Erro interno no servidor',
      message: error?.message,
    });
  }
};

export default withCors(linkSaveHandler);
