/**
 * @file api/_shared/retry.ts
 * @description Retry logic com exponential backoff para chamadas à API do iFood
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Executa fetch com retry automático em caso de rate limit ou erros temporários
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = retryOptions;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Se não for rate limit ou erro temporário, retorna
      if (response.status !== 429 && response.status !== 503) {
        return response;
      }

      // Rate limit ou serviço indisponível: aguarda e tenta novamente
      if (attempt < maxRetries - 1) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        console.warn(
          `[retry] ${response.status} received. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`
        );

        if (onRetry) {
          onRetry(attempt + 1, new Error(`HTTP ${response.status}`));
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return response; // Última tentativa, retorna mesmo com erro
      }
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        console.warn(
          `[retry] Network error. Waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`
        );

        if (onRetry) {
          onRetry(attempt + 1, lastError);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Wrapper para chamadas à API do iFood com retry automático
 */
export async function ifoodFetch(
  endpoint: string,
  options: RequestInit = {},
  retryOptions?: RetryOptions
): Promise<Response> {
  const baseUrl = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  return fetchWithRetry(url, options, retryOptions);
}
