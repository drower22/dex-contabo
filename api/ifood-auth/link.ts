/**
 * @file dex-contabo/api/ifood-auth/link.ts
 * @description Gera userCode para vínculo OAuth (Contabo deployment) - COM LOGS DE DEBUG
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('\n========== [LINK] INÍCIO DA REQUISIÇÃO ==========');
  console.log('[LINK] 📥 Method:', req.method);
  console.log('[LINK] 📥 URL:', req.url);
  console.log('[LINK] 📥 Query:', JSON.stringify(req.query, null, 2));
  console.log('[LINK] 📥 Body:', JSON.stringify(req.body, null, 2));
  
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    console.log('[LINK] ✅ OPTIONS request - returning 200');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('[LINK] ❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { storeId: bodyStoreId, merchantId } = req.body || {};

  console.log('[LINK] 🔍 Parsed params:', {
    scopeParam,
    scope,
    bodyStoreId,
    merchantId
  });

  try {
    // Usar apenas variáveis específicas por scope (sem fallback genérico)
    const clientId = scope === 'financial'
      ? process.env.IFOOD_CLIENT_ID_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_ID_REVIEWS
        : undefined;

    console.log('[LINK] 🔑 Credentials check:', {
      scope,
      hasClientIdFinancial: !!process.env.IFOOD_CLIENT_ID_FINANCIAL,
      hasClientIdReviews: !!process.env.IFOOD_CLIENT_ID_REVIEWS,
      selectedClientId: clientId ? `${clientId.substring(0, 8)}...` : 'undefined'
    });

    if (!clientId) {
      console.log('[LINK] ❌ Missing client credentials for scope:', scope);
      return res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} not configured`
      });
    }

    const requestBody = new URLSearchParams({
      client_id: clientId,
    });

    console.log('[LINK] 📤 Sending request to iFood API:', {
      url: `${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyParams: { client_id: `${clientId.substring(0, 8)}...` }
    });

    const response = await fetch(`${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestBody,
    });

    console.log('[LINK] 📥 iFood API response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });

    const data = await response.json();
    console.log('[LINK] 📥 iFood API response body:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.log('[LINK] ❌ iFood API returned error');
      return res.status(response.status).json({ 
        error: 'Falha ao solicitar código de autorização', 
        details: data,
        debug: {
          scope,
          clientIdUsed: `${clientId.substring(0, 8)}...`,
          ifoodStatus: response.status
        }
      });
    }

    // Persistência opcional
    try {
      let storeId = bodyStoreId;
      if (!storeId && merchantId) {
        console.log('[LINK] 🔍 Resolving storeId from merchantId:', merchantId);
        const { data: acc, error } = await supabase
          .from('accounts')
          .select('id')
          .eq('ifood_merchant_id', merchantId)
          .single();
        if (!error && acc?.id) {
          storeId = acc.id as string;
          console.log('[LINK] ✅ StoreId resolved:', storeId);
        } else {
          console.log('[LINK] ⚠️ Could not resolve storeId:', error?.message);
        }
      }

      if (storeId) {
        console.log('[LINK] 💾 Persisting to Supabase:', {
          account_id: storeId,
          scope,
          hasUserCode: !!data.userCode,
          hasVerifier: !!data.authorizationCodeVerifier
        });
        
        await supabase
          .from('ifood_store_auth')
          .upsert({
            account_id: storeId,
            scope: scope || 'reviews',
            link_code: data.userCode,
            verifier: data.authorizationCodeVerifier,
            status: 'pending',
          }, { onConflict: 'account_id,scope' });
        
        console.log('[LINK] ✅ Persisted to Supabase');
      } else {
        console.log('[LINK] ⚠️ No storeId available for persistence');
      }
    } catch (persistErr) {
      console.error('[LINK] ⚠️ Persistence error:', (persistErr as any)?.message || persistErr);
    }

    console.log('[LINK] ✅ SUCCESS - Returning userCode to client');
    console.log('========== [LINK] FIM DA REQUISIÇÃO ==========\n');
    res.status(200).json(data);

  } catch (e: any) {
    console.error('[LINK] ❌ EXCEPTION:', {
      message: e.message,
      stack: e.stack,
      name: e.name
    });
    console.log('========== [LINK] FIM DA REQUISIÇÃO (ERROR) ==========\n');
    res.status(500).json({ 
      error: 'Erro interno no servidor', 
      message: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
}
