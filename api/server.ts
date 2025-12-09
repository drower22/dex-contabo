/**
 * @file server.ts
 * @description Servidor Express TypeScript para rodar APIs do Contabo
 * Carrega handlers TypeScript diretamente usando ts-node
 */
// Registrar ts-node para permitir require() de arquivos .ts
require('ts-node/register');

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
          if (!res.headersSent) {
            res.status(code);
          }
          return vercelRes;
        },
        json: (data: any) => {
          if (!res.headersSent) {
            return res.json(data);
          }
        },
        send: (data: any) => {
          if (!res.headersSent) {
            return res.send(data);
          }
        },
        end: () => {
          if (!res.headersSent) {
            return res.end();
          }
        },
        setHeader: (key: string, value: string) => {
          if (!res.headersSent) {
            return res.setHeader(key, value);
          }
        },
      };
      
      await handler(vercelReq, vercelRes);
    } catch (error: any) {
      console.error('Handler error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Internal server error', 
          message: error.message 
        });
      }
    }
  };
}

// Carregar handlers TypeScript
console.log('🔄 Loading iFood API TypeScript handlers...');

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

// Carregar handlers de APIs do iFood (reorganizados)
const payoutsUnifiedHandler = loadHandler('./ifood/financial/payouts-unified');
const payoutsHandler = loadHandler('./ifood/financial/payouts');
const financialBuildSummaryHandler = loadHandler('./ifood/financial/build-summary');
const anticipationsHandler = loadHandler('./ifood/financial/anticipations');
const reconciliationIngestHandler = loadHandler('./ifood/reconciliation/ingest');
const reconciliationDebugHandler = loadHandler('./ifood/reconciliation/debug');
const reconciliationCalculateStatusHandler = loadHandler('./ifood/reconciliation/calculate-status');
const ifoodReconciliationHandler = loadHandler('./ifood/reconciliation/index');
const salesHandler = loadHandler('./ifood/sales/index');
const salesSyncHandler = loadHandler('./ifood/sales/sync');
const settlementsHandler = loadHandler('./ifood/settlements/index');
const settlementsTestHandler = loadHandler('./ifood/settlements/test');
const ifoodScheduleJobsCronHandler = loadHandler('./cron/ifood-schedule-jobs');
const anticipationsSyncHandler = loadHandler('./ifood/anticipations/sync');

// DEBUG: Verificar carregamento dos handlers
console.log('🔍 DEBUG salesSyncHandler:', salesSyncHandler ? 'LOADED ✅' : 'NULL ❌');
console.log('🔍 DEBUG settlementsHandler:', settlementsHandler ? 'LOADED ✅' : 'NULL ❌');
if (salesSyncHandler) {
  console.log('🔍 DEBUG salesSyncHandler exports:', Object.keys(salesSyncHandler));
}
if (settlementsHandler) {
  console.log('🔍 DEBUG settlementsHandler exports:', Object.keys(settlementsHandler));
}

// Proxy para iFood usando a função Vercel compartilhada
app.all('/api/ifood-proxy', async (req: Request, res: Response) => {
  const base = process.env.IFOOD_PROXY_BASE?.trim();
  const sharedKey = process.env.IFOOD_PROXY_KEY?.trim();

  if (!base || !sharedKey) {
    return res.status(500).json({
      error: 'ifood_proxy_not_configured',
      details: 'Defina IFOOD_PROXY_BASE e IFOOD_PROXY_KEY no .env do Contabo.'
    });
  }

  try {
    const parsedBase = new URL(base);
    const pathParam = req.query.path || req.query.PATH || req.query.url;
    const normalizedPath = typeof pathParam === 'string' && pathParam.length > 0
      ? pathParam.startsWith('/') ? pathParam : `/${pathParam}`
      : '/health';

    parsedBase.searchParams.set('path', normalizedPath);
    const upstreamUrl = parsedBase.toString();

    const headers = new Headers();
    headers.set('x-shared-key', sharedKey);
    // Replicar cabeçalhos relevantes (excluir headers que causam erro no fetch)
    const forbiddenHeaders = [
      'host', 'x-forwarded-for', 'x-real-ip', 
      'connection', 'keep-alive', 'transfer-encoding', 
      'content-length', 'upgrade', 'expect'
    ];
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      if (forbiddenHeaders.includes(key.toLowerCase())) continue;
      const headerValue = Array.isArray(value) ? value.join(',') : value;
      headers.set(key, String(headerValue));
    }

    const init: RequestInit = {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body ? JSON.stringify(req.body) : undefined,
    };

    const upstreamResp = await fetch(upstreamUrl, init);
    const text = await upstreamResp.text();

    res.status(upstreamResp.status);
    for (const [key, value] of upstreamResp.headers.entries()) {
      res.setHeader(key, value);
    }
    res.send(text);
  } catch (err: any) {
    console.error('[ifood-proxy] error', err);
    res.status(500).json({ error: 'proxy_failure', message: err?.message || String(err) });
  }
});

// ============================================
// ROTAS DE API DO IFOOD (Dados e Financeiro)
// ============================================
// Auth agora é 100% Supabase Edge Functions

// Rotas financeiras
if (payoutsUnifiedHandler) {
  app.get('/api/ifood/financial/payouts-unified', adaptVercelHandler(payoutsUnifiedHandler));
  console.log('✅ Payouts unified handler loaded');
} else {
  app.get('/api/ifood/financial/payouts-unified', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Payouts unified handler not loaded' });
  });
}

if (payoutsHandler) {
  app.get('/api/ifood/financial/payouts', adaptVercelHandler(payoutsHandler));
  console.log('✅ Payouts handler loaded');
} else {
  app.get('/api/ifood/financial/payouts', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Payouts handler not loaded' });
  });
}

if (financialBuildSummaryHandler) {
  app.post('/api/ifood/financial/build-summary', adaptVercelHandler(financialBuildSummaryHandler));
  app.get('/api/ifood/financial/build-summary', adaptVercelHandler(financialBuildSummaryHandler));
  console.log('✅ Financial build-summary handler loaded');
} else {
  app.all('/api/ifood/financial/build-summary', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Financial build-summary handler not loaded' });
  });
}

if (anticipationsHandler) {
  app.get('/api/ifood/financial/anticipations', adaptVercelHandler(anticipationsHandler));
  console.log('✅ Anticipations handler loaded');
} else {
  app.get('/api/ifood/financial/anticipations', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Anticipations handler not loaded' });
  });
}

// Rotas de conciliação (ingest)
if (reconciliationIngestHandler) {
  app.all('/api/ingest/ifood-reconciliation', adaptVercelHandler(reconciliationIngestHandler));
  console.log('✅ Reconciliation ingest handler loaded');
} else {
  app.all('/api/ingest/ifood-reconciliation', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Reconciliation ingest handler not loaded' });
  });
}

if (reconciliationDebugHandler) {
  app.get('/api/ingest/ifood-reconciliation-debug', adaptVercelHandler(reconciliationDebugHandler));
  console.log('✅ Reconciliation debug handler loaded');
}

if (ifoodReconciliationHandler) {
  app.all('/api/ifood/reconciliation', adaptVercelHandler(ifoodReconciliationHandler));
  console.log('✅ iFood reconciliation API handler loaded');
} else {
  app.all('/api/ifood/reconciliation', (req: Request, res: Response) => {
    res.status(500).json({ error: 'iFood reconciliation handler not loaded' });
  });
}

// Cálculo de status de conciliação pedido-a-pedido
if (reconciliationCalculateStatusHandler) {
  app.post('/api/ifood/reconciliation/calculate-status', adaptVercelHandler(reconciliationCalculateStatusHandler));
  console.log('✅ Reconciliation calculate-status handler loaded');
} else {
  app.post('/api/ifood/reconciliation/calculate-status', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Reconciliation calculate-status handler not loaded' });
  });
}

// Cron de refresh de tokens agora é via GitHub Actions + Supabase

// Cron para agendar jobs diários de conciliação iFood (usado via CRON_SECRET no Contabo)
if (ifoodScheduleJobsCronHandler) {
  app.post('/api/cron/ifood-schedule-jobs', adaptVercelHandler(ifoodScheduleJobsCronHandler));
  console.log('✅ iFood schedule jobs cron handler loaded');
} else {
  app.post('/api/cron/ifood-schedule-jobs', (req: Request, res: Response) => {
    res.status(500).json({ error: 'iFood schedule jobs cron handler not loaded' });
  });
}

// Rotas de Sales
if (salesHandler) {
  app.get('/api/ifood/sales', adaptVercelHandler(salesHandler));
  console.log('✅ Sales handler loaded');
} else {
  app.get('/api/ifood/sales', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Sales handler not loaded' });
  });
}

// Rotas de Settlements
if (settlementsHandler) {
  app.post('/api/ifood/settlements', adaptVercelHandler(settlementsHandler));
  console.log('✅ Settlements handler loaded');
} else {
  app.post('/api/ifood/settlements', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Settlements handler not loaded' });
  });
}

// Rotas de Settlements (Test)
if (settlementsTestHandler) {
  app.post('/api/ifood/settlements/test', adaptVercelHandler(settlementsTestHandler));
  console.log('✅ Settlements test handler loaded');
} else {
  app.post('/api/ifood/settlements/test', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Settlements test handler not loaded' });
  });
}

// Rotas de Antecipações (Sync)
if (anticipationsSyncHandler) {
  app.post('/api/ifood/anticipations/sync', anticipationsSyncHandler);
  console.log('✅ Anticipations sync handler loaded');
} else {
  app.post('/api/ifood/anticipations/sync', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Anticipations sync handler not loaded' });
  });
}


// Rotas de Sync de Vendas (Sync Direto - sem worker)
if (salesSyncHandler) {
  app.post('/api/ifood/sales/sync', salesSyncHandler.syncIfoodSales);
  app.get('/api/ifood/sales/sync/:jobId', salesSyncHandler.syncIfoodSales); // Redireciona GET para o mesmo handler
  console.log('✅ Sales sync handler loaded (direct sync)');
} else {
  app.post('/api/ifood/sales/sync', (req: Request, res: Response) => {
    res.status(500).json({ error: 'Sales sync handler not loaded' });
  });
  app.get('/api/ifood/sales/sync/:jobId', (req: Request, res: Response) => {
    res.status(200).json({ message: 'Worker desabilitado. Use POST para sync direto.' });
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
const server = app.listen(PORT, () => {
  console.log(`🚀 Dex Contabo API (TypeScript) running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔷 TypeScript: Enabled via ts-node`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error('❌ Failed to start Dex Contabo API: port already in use', {
      port: PORT,
      pid: process.pid,
      message: error.message,
    });
    console.error('👉 Dica: execute "sudo lsof -i :%s -nP" para identificar o processo e finalize-o com "sudo kill -9 <PID>".', PORT);
  } else {
    console.error('❌ Server listen error', {
      port: PORT,
      pid: process.pid,
      code: error.code,
      message: error.message,
    });
  }

  process.exit(1);
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
