/**
 * @file api/_shared/account-resolver.ts
 * @description Resolução centralizada de IDs de conta
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './config';

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

export interface AccountInfo {
  id: string;
  ifood_merchant_id: string | null;
}

/**
 * Resolve um identificador (UUID ou merchantId) para o account_id interno
 * 
 * @param identifier - Pode ser:
 *   - UUID da tabela accounts (accounts.id)
 *   - merchantId do iFood (accounts.ifood_merchant_id)
 * @returns AccountInfo com id interno e merchantId
 * @throws Error se conta não for encontrada
 */
export async function resolveAccountId(identifier: string): Promise<AccountInfo> {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error('Identifier must be a non-empty string');
  }

  const trimmedId = identifier.trim();

  // Estratégia 1: Tentar como UUID direto (accounts.id)
  const { data: byId, error: errorById } = await supabase
    .from('accounts')
    .select('id, ifood_merchant_id')
    .eq('id', trimmedId)
    .maybeSingle();

  if (byId?.id) {
    return {
      id: byId.id as string,
      ifood_merchant_id: (byId.ifood_merchant_id as string | null) ?? null,
    };
  }

  // Estratégia 2: Tentar como merchantId (accounts.ifood_merchant_id)
  const { data: byMerchant, error: errorByMerchant } = await supabase
    .from('accounts')
    .select('id, ifood_merchant_id')
    .eq('ifood_merchant_id', trimmedId)
    .maybeSingle();

  if (byMerchant?.id) {
    return {
      id: byMerchant.id as string,
      ifood_merchant_id: (byMerchant.ifood_merchant_id as string | null) ?? null,
    };
  }

  // Nenhuma estratégia funcionou
  throw new Error(
    `Account not found for identifier: ${trimmedId}. ` +
    `Tried as accounts.id (UUID) and accounts.ifood_merchant_id (merchantId).`
  );
}

/**
 * Busca múltiplas contas por IDs
 * @param identifiers - Array de UUIDs ou merchantIds
 * @returns Array de AccountInfo encontradas
 */
export async function resolveMultipleAccounts(identifiers: string[]): Promise<AccountInfo[]> {
  const results: AccountInfo[] = [];
  
  for (const id of identifiers) {
    try {
      const account = await resolveAccountId(id);
      results.push(account);
    } catch (error) {
      // Ignora contas não encontradas
      console.warn(`[account-resolver] Failed to resolve: ${id}`, error);
    }
  }
  
  return results;
}

/**
 * Valida se uma conta existe
 * @param identifier - UUID ou merchantId
 * @returns true se conta existe, false caso contrário
 */
export async function accountExists(identifier: string): Promise<boolean> {
  try {
    await resolveAccountId(identifier);
    return true;
  } catch {
    return false;
  }
}
