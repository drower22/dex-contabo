/**
 * @file server.js
 * @description Servidor Express Node.js para rodar APIs do Contabo
 * Versão JavaScript puro (convertido de TypeScript)
 */
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

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
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check básico
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    javascript: true
  });
});

/**
 * Adapter para converter handlers Vercel em handlers Express
 */
function adaptVercelHandler(handler) {
  return async (req, res) => {
    try {
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
      console.error('Handler error:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        message: error.message 
      });
    }
  };
}

// Carregar handlers JavaScript
console.log('🔄 Loading iFood Auth handlers...');

// Helper para carregar handler com fallback
function loadHandler(modulePath) {
  try {
    const handler = require(modulePath);
    
    // Se for uma função diretamente, retornar
    if (typeof handler === 'function') {
      return handler;
    }
    
    // Se for um objeto com default, retornar default
    if (handler && typeof handler.default === 'function') {
      return handler.default;
    }
    
    // Se for um objeto com handler, retornar handler
    if (handler && typeof handler.handler === 'function') {
      return handler.handler;
    }
    
    console.error(`❌ No function found in ${modulePath}`);
    return null;
  } catch (error) {
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
  app.get('/api/ifood-auth/health', (req, res) => {
    res.status(500).json({ error: 'Health handler not loaded' });
  });
}

if (linkHandler) {
  app.post('/api/ifood-auth/link', adaptVercelHandler(linkHandler));
  console.log('✅ Link handler loaded');
} else {
  app.post('/api/ifood-auth/link', (req, res) => {
    res.status(500).json({ error: 'Link handler not loaded' });
  });
}

if (exchangeHandler) {
  app.post('/api/ifood-auth/exchange', adaptVercelHandler(exchangeHandler));
  console.log('✅ Exchange handler loaded');
} else {
  app.post('/api/ifood-auth/exchange', (req, res) => {
    res.status(500).json({ error: 'Exchange handler not loaded' });
  });
}

if (refreshHandler) {
  app.post('/api/ifood-auth/refresh', adaptVercelHandler(refreshHandler));
  console.log('✅ Refresh handler loaded');
} else {
  app.post('/api/ifood-auth/refresh', (req, res) => {
    res.status(500).json({ error: 'Refresh handler not loaded' });
  });
}

if (statusHandler) {
  app.get('/api/ifood-auth/status', adaptVercelHandler(statusHandler));
  console.log('✅ Status handler loaded');
} else {
  app.get('/api/ifood-auth/status', (req, res) => {
    res.status(500).json({ error: 'Status handler not loaded' });
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Dex Contabo API (Node.js) running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🟢 JavaScript: Pure Node.js`);
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

module.exports = app;
