// Servidor Express simples para rodar APIs TypeScript do Vercel no Contabo
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Carregar .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check básico
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Wrapper para adaptar Vercel handlers para Express
function adaptVercelHandler(handlerPath) {
  return async (req, res) => {
    try {
      // Importar handler TypeScript compilado ou usar require direto
      const handler = require(handlerPath).default || require(handlerPath);
      
      // Criar objetos compatíveis com Vercel
      const vercelReq = {
        ...req,
        query: req.query,
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.url,
      };
      
      const vercelRes = {
        status: (code) => {
          res.status(code);
          return vercelRes;
        },
        json: (data) => res.json(data),
        send: (data) => res.send(data),
        end: () => res.end(),
        setHeader: (key, value) => res.setHeader(key, value),
      };
      
      await handler(vercelReq, vercelRes);
    } catch (error) {
      console.error(`Error in ${handlerPath}:`, error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };
}

// Rotas iFood Auth - Tentar carregar handlers TypeScript
console.log('Loading iFood Auth routes...');

// Por enquanto, criar endpoints básicos que retornam 501
app.get('/api/ifood-auth/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    message: 'iFood Auth API is running',
    checks: {
      server: true,
      env: !!process.env.SUPABASE_URL,
      encryption: !!process.env.ENCRYPTION_KEY,
    }
  });
});

app.post('/api/ifood-auth/link', (req, res) => {
  res.status(501).json({ error: 'Not implemented - TypeScript compilation needed' });
});

app.post('/api/ifood-auth/exchange', (req, res) => {
  res.status(501).json({ error: 'Not implemented - TypeScript compilation needed' });
});

app.post('/api/ifood-auth/refresh', (req, res) => {
  res.status(501).json({ error: 'Not implemented - TypeScript compilation needed' });
});

// Carregar handler de status
const statusHandler = require('./ifood-auth/status.js');
app.get('/api/ifood-auth/status', statusHandler);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Dex Contabo API running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`⚠️  TypeScript handlers need compilation - using basic endpoints for now`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});
