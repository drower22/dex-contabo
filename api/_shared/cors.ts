import type { VercelRequest, VercelResponse } from '@vercel/node';

const allowedOrigins = [
  'http://localhost:5173', // Desenvolvimento local
  'https://app.dex.com.br',    // Produção
  'https://app.usa-dex.com.br',
  process.env.CORS_ORIGIN, // Fallback para variável de ambiente
].filter(Boolean) as string[];

export function withCors(handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    return handler(req, res);
  };
}
