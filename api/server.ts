/**
 * @file server.ts
 * @description Servidor Express TypeScript para rodar APIs do Contabo
 * Carrega handlers TypeScript diretamente usando ts-node
 */
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Carregar .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({ 
  origin: (origin, callback) => {
    const raw = (process.env.CORS_ORIGIN || '*').trim();
    const allowed = raw.split(',').map(s => s.trim());
    if (allowed.includes('*') || !origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check básico
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    typescript: true
  });
});

/**
 * Adapter para converter handlers Vercel em handlers Express
 */
function adaptVercelHandler(handler: (req: any, res: any) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      // Criar objetos compatíveis com Vercel
      const vercelReq: any = {
        ...req,
        query: req.query,
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.url,
      };
      
      const vercelRes: any = {
        status: (code: number) => {
          res.status(code);
          return vercelRes;
        },
        json: (data: any) => res.json(data),
        send: (data: any) => res.send(data),
        end: () => res.end(),
        setHeader: (key: string, value: string) => res.setHeader(key, value),
      };
      
      await handler(vercelReq, vercelRes);
    } catch (error: any) {
      console.error('Handler error:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        message: error.message 
      });
    }
  };
}

// Carregar handlers TypeScript
console.log('🔄 Loading iFood Auth TypeScript handlers...');

// Helper para carregar handler com fallback
function loadHandler(modulePath: string) {
  try {
    const module = require(modulePath);
    // Tentar pegar o export default ou o export nomeado
    return module.default || module;
  } catch (error: any) {
    console.error(`❌ Failed to load ${modulePath}:`, error.message);
    return null;
  }
}

// Carregar handlers
const healthHandler = loadHandler('./ifood-auth/health');
const linkHandler = loadHandler('./ifood-auth/link');
const exchangeHandler = loadHandler('./ifood-auth/exchange');
const refreshHandler = loadHandler('./ifood-auth/refresh');
const statusHandler = loadHandler('./ifood-auth/status');

// Montar rotas
if (healthHandler) {
  app.get('/api/ifood-auth/health', adaptVercelHandler(healthHandler));
  console.log('✅ Health handler loaded');
} else {
  app.get('/api/ifood-auth/health', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Health handler not loaded' });
  });
}

if (linkHandler) {
  app.post('/api/ifood-auth/link', adaptVercelHandler(linkHandler));
  console.log('✅ Link handler loaded');
} else {
  app.post('/api/ifood-auth/link', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Link handler not loaded' });
  });
}

if (exchangeHandler) {
  app.post('/api/ifood-auth/exchange', adaptVercelHandler(exchangeHandler));
  console.log('✅ Exchange handler loaded');
} else {
  app.post('/api/ifood-auth/exchange', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Exchange handler not loaded' });
  });
}

if (refreshHandler) {
  app.post('/api/ifood-auth/refresh', adaptVercelHandler(refreshHandler));
  console.log('✅ Refresh handler loaded');
} else {
  app.post('/api/ifood-auth/refresh', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Refresh handler not loaded' });
  });
}

if (statusHandler) {
  app.get('/api/ifood-auth/status', adaptVercelHandler(statusHandler));
  console.log('✅ Status handler loaded');
} else {
  app.get('/api/ifood-auth/status', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Status handler not loaded' });
  });
}

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Dex Contabo API (TypeScript) running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔷 TypeScript: Enabled via ts-node`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
