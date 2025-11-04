// Servidor Express para rodar as APIs do dex-contabo
// Converte Vercel serverless functions para servidor Node.js tradicional

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger simples
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Importar e montar rotas do iFood Auth
try {
  const healthHandler = require('./ifood-auth/health');
  const linkHandler = require('./ifood-auth/link');
  const exchangeHandler = require('./ifood-auth/exchange');
  const refreshHandler = require('./ifood-auth/refresh');
  const statusHandler = require('./ifood-auth/status');

  // Montar rotas
  app.get('/api/ifood-auth/health', healthHandler);
  app.post('/api/ifood-auth/link', linkHandler);
  app.post('/api/ifood-auth/exchange', exchangeHandler);
  app.post('/api/ifood-auth/refresh', refreshHandler);
  app.get('/api/ifood-auth/status', statusHandler);

  console.log('✅ iFood Auth routes loaded');
} catch (error) {
  console.error('❌ Error loading iFood Auth routes:', error.message);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Dex Contabo API rodando em http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
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
