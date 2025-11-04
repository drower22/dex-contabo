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
  origin: process.env.CORS_ORIGIN || '*', 
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

try {
  // Importar handlers TypeScript
  const healthHandler = require('./ifood-auth/health').default;
  const linkHandler = require('./ifood-auth/link').default;
  const exchangeHandler = require('./ifood-auth/exchange').default;
  const refreshHandler = require('./ifood-auth/refresh').default;
  const statusHandler = require('./ifood-auth/status').default;
  
  // Montar rotas com adapter
  app.get('/api/ifood-auth/health', adaptVercelHandler(healthHandler));
  app.post('/api/ifood-auth/link', adaptVercelHandler(linkHandler));
  app.post('/api/ifood-auth/exchange', adaptVercelHandler(exchangeHandler));
  app.post('/api/ifood-auth/refresh', adaptVercelHandler(refreshHandler));
  app.get('/api/ifood-auth/status', adaptVercelHandler(statusHandler));
  
  console.log('✅ iFood Auth TypeScript handlers loaded successfully');
} catch (error: any) {
  console.error('❌ Error loading TypeScript handlers:', error.message);
  console.error('Stack:', error.stack);
  
  // Fallback: endpoints que retornam erro claro
  app.get('/api/ifood-auth/health', (req: Request, res: Response) => {
    res.status(500).json({ 
      error: 'Handler not loaded', 
      details: error.message,
      hint: 'Check if ts-node is installed and TypeScript files are accessible'
    });
  });
  
  app.post('/api/ifood-auth/link', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Handler not loaded', details: error.message });
  });
  
  app.post('/api/ifood-auth/exchange', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Handler not loaded', details: error.message });
  });
  
  app.post('/api/ifood-auth/refresh', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Handler not loaded', details: error.message });
  });
  
  app.get('/api/ifood-auth/status', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Handler not loaded', details: error.message });
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
