const DEFAULT_IFOOD_BASE = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

const proxyBase = process.env.IFOOD_PROXY_BASE?.trim();
const proxyKey = process.env.IFOOD_PROXY_KEY?.trim();

export function buildIFoodUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!proxyBase) {
    return `${DEFAULT_IFOOD_BASE}${normalized}`;
  }

  const url = new URL(proxyBase);
  url.searchParams.set('path', normalized);
  return url.toString();
}

export function withIFoodProxy(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers ?? {});
  if (proxyBase && proxyKey) {
    headers.set('x-shared-key', proxyKey);
  }

  headers.delete('host');
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');

  return {
    ...init,
    headers,
  } satisfies RequestInit;
}
