/**
 * @file api/ifood-auth/link.refactored.ts
 * @description VERSÃO REFATORADA - Gera userCode para vínculo OAuth
 * 
 * MELHORIAS:
 * - ✅ Usa ifoodClient centralizado
 * - ✅ Usa account-resolver para lookup
 * - ✅ Logs estruturados com trace IDs
 * - ✅ Tratamento de erros consistente
 * - ✅ Código mais limpo e legível
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { ifoodClient } from '../_shared/ifood-client';
import { resolveAccountId } from '../_shared/account-resolver';
import { logger } from '../_shared/enhanced-logger';
import { config, getCorsOrigin } from '../_shared/config';
import type { Scope } from '../_shared/ifood-client';

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin());
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Gerar trace ID para rastreamento
  const traceId = `link-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  const contextLogger = logger.withContext({ traceId, endpoint: 'link' });

  try {
    // Extrair parâmetros
    const scopeParam = (req.query.scope as string) || req.body?.scope;
    const scope: Scope = scopeParam === 'financial' ? 'financial' : 'reviews';
    const { storeId: bodyStoreId, merchantId } = req.body || {};

    contextLogger.info('Solicitação de userCode recebida', { scope, hasStoreId: !!bodyStoreId, hasMerchantId: !!merchantId });

    // Solicitar userCode do iFood
    const data = await ifoodClient.requestUserCode(scope);
    
    contextLogger.info('UserCode gerado com sucesso', {
      scope,
      userCode: data.userCode,
      expiresIn: data.expiresIn,
    });

    // Persistir link_code e verifier se tivermos identificador da conta
    if (bodyStoreId || merchantId) {
      try {
        const identifier = (bodyStoreId || merchantId) as string;
        const account = await resolveAccountId(identifier);
        
        contextLogger.debug('Conta resolvida', {
          accountId: account.id,
          merchantId: account.ifood_merchant_id || undefined,
        });

        await supabase
          .from('ifood_store_auth')
          .upsert(
            {
              account_id: account.id,
              scope,
              link_code: data.userCode,
              verifier: data.authorizationCodeVerifier,
              status: 'pending',
            },
            { onConflict: 'account_id,scope' }
          );

        contextLogger.info('Link code persistido no banco', {
          accountId: account.id,
          scope,
        });
      } catch (persistError: any) {
        // Não bloquear resposta se persistência falhar
        contextLogger.warn('Falha ao persistir link code (não crítico)', {
          error: persistError.message,
        });
      }
    } else {
      contextLogger.debug('Nenhum identificador fornecido, pulando persistência');
    }

    // Retornar userCode para o cliente
    return res.status(200).json({
      ...data,
      traceId, // Incluir trace ID na resposta para debug
    });

  } catch (error: any) {
    contextLogger.error('Erro ao gerar userCode', error);

    // Determinar status code baseado no erro
    const statusCode = error.message?.includes('credentials') ? 500 : 500;

    return res.status(statusCode).json({
      error: 'Erro ao solicitar código de autorização',
      message: error.message,
      traceId,
    });
  }
}
