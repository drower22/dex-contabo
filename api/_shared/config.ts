/**
 * @file api/_shared/config.ts
 * @description Configurações centralizadas da API
 */

export interface IFoodCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Obtém credenciais do iFood baseado no escopo
 * @param scope - 'reviews' ou 'financial'
 * @returns Credenciais do cliente iFood
 * @throws Error se credenciais não estiverem configuradas
 */
export function getIFoodCredentials(scope: 'reviews' | 'financial'): IFoodCredentials {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (scope === 'financial') {
    clientId = process.env.IFOOD_CLIENT_ID_FINANCIAL || process.env.IFOOD_CLIENT_ID;
    clientSecret = process.env.IFOOD_CLIENT_SECRET_FINANCIAL || process.env.IFOOD_CLIENT_SECRET;
  } else {
    // reviews
    clientId = process.env.IFOOD_CLIENT_ID_REVIEWS || process.env.IFOOD_CLIENT_ID;
    clientSecret = process.env.IFOOD_CLIENT_SECRET_REVIEWS || process.env.IFOOD_CLIENT_SECRET;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing iFood credentials for scope "${scope}". ` +
      `Please set IFOOD_CLIENT_ID_${scope.toUpperCase()} and IFOOD_CLIENT_SECRET_${scope.toUpperCase()} ` +
      `or fallback IFOOD_CLIENT_ID and IFOOD_CLIENT_SECRET`
    );
  }

  return { clientId, clientSecret };
}

/**
 * Obtém URL base da API iFood
 */
export function getIFoodBaseUrl(): string {
  return (
    process.env.IFOOD_BASE_URL || 
    process.env.IFOOD_API_URL || 
    'https://merchant-api.ifood.com.br'
  ).trim();
}

/**
 * Obtém origem CORS permitida
 */
export function getCorsOrigin(): string {
  return process.env.CORS_ORIGIN || '*';
}

/**
 * Valida se todas as variáveis de ambiente obrigatórias estão configuradas
 * @throws Error com lista de variáveis faltando
 */
export function validateEnvironment(): void {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ENCRYPTION_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check your .env file or environment configuration.`
    );
  }

  // Validar pelo menos um conjunto de credenciais iFood
  const hasReviews = process.env.IFOOD_CLIENT_ID_REVIEWS && process.env.IFOOD_CLIENT_SECRET_REVIEWS;
  const hasFinancial = process.env.IFOOD_CLIENT_ID_FINANCIAL && process.env.IFOOD_CLIENT_SECRET_FINANCIAL;
  const hasFallback = process.env.IFOOD_CLIENT_ID && process.env.IFOOD_CLIENT_SECRET;

  if (!hasReviews && !hasFinancial && !hasFallback) {
    throw new Error(
      'Missing iFood credentials. Please set at least one of:\n' +
      '- IFOOD_CLIENT_ID_REVIEWS + IFOOD_CLIENT_SECRET_REVIEWS\n' +
      '- IFOOD_CLIENT_ID_FINANCIAL + IFOOD_CLIENT_SECRET_FINANCIAL\n' +
      '- IFOOD_CLIENT_ID + IFOOD_CLIENT_SECRET (fallback)'
    );
  }
}

/**
 * Configurações exportadas
 */
export const config = {
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  },
  ifood: {
    baseUrl: getIFoodBaseUrl(),
  },
  cors: {
    origin: getCorsOrigin(),
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY!,
  },
} as const;
