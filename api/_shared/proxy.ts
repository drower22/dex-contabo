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
  const { base } = getProxyConfig();
  const normalized = normalizePath(path);

  if (!base) {
    return `${DEFAULT_IFOOD_BASE}${normalized}`;
  }

  const url = new URL(base);
  url.searchParams.set('path', normalized);
  return url.toString();
}

export function proxifyIFoodUrl(url: string): string {
  const { base } = getProxyConfig();
  if (!base) return url;

  try {
    const parsed = new URL(url);
    const normalized = normalizePath(`${parsed.pathname}${parsed.search}`);
    return buildIFoodUrl(normalized);
  } catch {
    return buildIFoodUrl(url);
  }
}

export function withIFoodProxy(init?: RequestInit): RequestInit {
  const { base, key } = getProxyConfig();
  const headers = new Headers(init?.headers ?? {});

  if (base && key) {
    headers.set('x-shared-key', key);
  }

  headers.delete('host');
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');

  return {
    ...init,
    headers,
  } satisfies RequestInit;
}
