const DEFAULT_IFOOD_BASE = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();

function getProxyConfig() {
  const base = process.env.IFOOD_PROXY_BASE?.trim() || '';
  const key = process.env.IFOOD_PROXY_KEY?.trim() || '';
  return { base, key };
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function buildIFoodUrl(path: string): string {
  const normalized = normalizePath(path);
  return `${DEFAULT_IFOOD_BASE}${normalized}`;
}

export function proxifyIFoodUrl(url: string): string {
  const { base } = getProxyConfig();
  if (!base) return url;

  try {
    const parsed = new URL(url);
    const normalized = normalizePath(`${parsed.pathname}${parsed.search}`);
    const proxyUrl = new URL(base);
    proxyUrl.searchParams.set('path', normalized);
    return proxyUrl.toString();
  } catch {
    return url;
  }
}

export function withIFoodProxy(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers ?? {});

  // Remover headers que causam erro no fetch do Node.js
  const forbiddenHeaders = [
    'host', 'x-forwarded-for', 'x-real-ip',
    'connection', 'keep-alive', 'transfer-encoding',
    'content-length', 'upgrade', 'expect'
  ];
  forbiddenHeaders.forEach(h => headers.delete(h));

  return {
    ...init,
    headers,
  } satisfies RequestInit;
}
