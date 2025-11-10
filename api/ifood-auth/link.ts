/**
 * @file dex-contabo/api/ifood-auth/link.ts
 * @description Gera userCode para vínculo OAuth (Contabo deployment)
 * 
 * Versão do link.ts para deployment no Contabo.
 * Rota serverless responsável por SOLICITAR o `userCode` (código de vínculo) do fluxo de autenticação distribuída.
 *
 * Contexto de credenciais (dois apps):
 * - Ambiente possui dois clientes distintos no iFood: (1) merchant+reviews e (2) merchant+financial.
 * - Cada scope requer suas próprias credenciais específicas.
 *
 * Variáveis de ambiente utilizadas:
 * - IFOOD_BASE_URL (opcional) | IFOOD_API_URL (opcional) | default: https://merchant-api.ifood.com.br
 * - IFOOD_CLIENT_ID_REVIEWS (obrigatória para scope=reviews)
 * - IFOOD_CLIENT_ID_FINANCIAL (obrigatória para scope=financial)
 * - CORS_ORIGIN (opcional)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Rota dedicada para solicitar o código de autorização (userCode).

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const scopeParam = (req.query.scope as string) || req.body?.scope;
  const scope = scopeParam === 'financial' ? 'financial' : (scopeParam === 'reviews' ? 'reviews' : undefined);
  const { storeId: bodyStoreId, merchantId } = req.body || {};

  try {
    // Usar apenas variáveis específicas por scope (sem fallback genérico)
    const clientId = scope === 'financial'
      ? process.env.IFOOD_CLIENT_ID_FINANCIAL
      : scope === 'reviews'
        ? process.env.IFOOD_CLIENT_ID_REVIEWS
        : undefined;

    if (!clientId) {
      return res.status(400).json({ 
        error: 'Missing client credentials',
        message: `IFOOD_CLIENT_ID_${scope?.toUpperCase()} not configured`
      });
    }

    const response = await fetch(`${IFOOD_BASE_URL}/authentication/v1.0/oauth/userCode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Falha ao solicitar código de autorização', details: data });
    }

    // Persistência opcional: se tivermos storeId (interno) diretamente ou via merchantId, salvar link_code/verifier por escopo
    try {
      let storeId = bodyStoreId;
      if (!storeId && merchantId) {
        const { data: acc, error } = await supabase
          .from('accounts')
          .select('id')
          .eq('ifood_merchant_id', merchantId)
          .single();
        if (!error && acc?.id) storeId = acc.id as string;
      }

      if (storeId) {
        await supabase
          .from('ifood_store_auth')
          .upsert({
            account_id: storeId,
            scope: scope || 'reviews',
            link_code: data.userCode,
            verifier: data.authorizationCodeVerifier,
            status: 'pending',
          }, { onConflict: 'account_id,scope' });
      }
    } catch (persistErr) {
      // Não bloquear a resposta ao cliente caso a persistência falhe
      console.warn('[ifood-auth/link] persist warning:', (persistErr as any)?.message || persistErr);
    }

    // O corpo da resposta do iFood já contém `userCode`, `authorizationCodeVerifier`, etc.
    res.status(200).json(data);

  } catch (e: any) {
    res.status(500).json({ error: 'Erro interno no servidor', message: e.message });
  }
}
