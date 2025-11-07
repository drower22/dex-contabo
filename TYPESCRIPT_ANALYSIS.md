# 📊 Análise Completa da Estrutura TypeScript

## ✅ Status Atual: MIGRAÇÃO COMPLETA PARA TYPESCRIPT

### Arquitetura

```
dex-contabo/
├── api/
│   ├── server.ts          ✅ Servidor Express TypeScript (PRINCIPAL)
│   ├── server.js          ⚠️  Versão antiga JS (NÃO USAR)
│   ├── ifood-auth/
│   │   ├── health.ts      ✅ TypeScript
│   │   ├── link.ts        ✅ TypeScript
│   │   ├── exchange.ts    ✅ TypeScript
│   │   ├── refresh.ts     ✅ TypeScript
│   │   ├── status.ts      ✅ TypeScript
│   │   ├── *.js           ⚠️  Versões antigas JS (NÃO USAR)
│   ├── _shared/
│   │   ├── crypto.ts      ✅ Utilitários de criptografia
│   │   ├── discord.ts     ✅ Notificações Discord
│   │   ├── logger.ts      ✅ Sistema de logs
│   │   └── retry.ts       ✅ Retry logic
├── tsconfig.json          ✅ Configuração TypeScript
├── ecosystem.config.js    ✅ Configuração PM2
└── package.json           ✅ Dependências

```

## 🔧 Configuração TypeScript

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node", "vitest/globals"]
  },
  "include": ["api/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "backend", "sqlagent"]
}
```

### ecosystem.config.js (PM2)
```javascript
{
  name: 'dex-api',
  script: './api/server.ts',
  interpreter: 'node',
  interpreter_args: '-r ts-node/register',  // ← CRÍTICO!
  instances: 2,
  exec_mode: 'cluster',
  env: {
    NODE_ENV: 'production',
    PORT: 3000,
    TS_NODE_PROJECT: './tsconfig.json',
  }
}
```

## 📝 Handlers iFood Auth

Todos os handlers seguem o padrão Vercel Serverless:

### 1. health.ts
- **Rota**: `GET /api/ifood-auth/health`
- **Função**: Health check da API iFood
- **Export**: `export default async function handler(req, res)`

### 2. link.ts
- **Rota**: `POST /api/ifood-auth/link`
- **Função**: Gera `userCode` para vinculação OAuth
- **Parâmetros**: `scope` (reviews | financial), `storeId`, `merchantId`
- **Export**: `export default async function handler(req, res)`

### 3. exchange.ts
- **Rota**: `POST /api/ifood-auth/exchange`
- **Função**: Troca `authorizationCode` por `access_token` e `refresh_token`
- **Parâmetros**: `authorizationCode`, `authorizationCodeVerifier`, `scope`, `accountId`
- **Export**: `export default async function handler(req, res)`

### 4. refresh.ts
- **Rota**: `POST /api/ifood-auth/refresh`
- **Função**: Renova `access_token` usando `refresh_token`
- **Parâmetros**: `accountId`, `scope`
- **Export**: `export default async function handler(req, res)`

### 5. status.ts
- **Rota**: `GET /api/ifood-auth/status`
- **Função**: Verifica status da autenticação validando token na API iFood
- **Parâmetros**: `accountId`, `scope`
- **Export**: `export default async function handler(req, res)`

## 🔄 Fluxo de Carregamento

### server.ts (Linha 88-106)

```typescript
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
} catch (error) {
  console.error('❌ Error loading TypeScript handlers:', error);
  // Fallback com erro 500
}
```

### Adapter Vercel → Express (Linha 50-86)

```typescript
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
```

## ⚠️ Problemas Identificados

### 1. Arquivos Duplicados (.js e .ts)
- ❌ **Problema**: Existem versões `.js` antigas que podem causar confusão
- ✅ **Solução**: Deletar todos os `.js` em `api/ifood-auth/`

### 2. CORS Duplicado
- ❌ **Problema**: Cada handler define CORS individualmente
- ✅ **Solução**: O middleware global no `server.ts` já cuida disso
- 📝 **Ação**: Remover `res.setHeader('Access-Control-Allow-Origin'...)` dos handlers

### 3. Variáveis de Ambiente
- ✅ **Correto**: `/var/www/dex-contabo/.env` tem `CORS_ORIGIN=*`
- ⚠️  **Atenção**: `/home/dex/dex-app/.env` é diferente (não é usado)

## 🚀 Como Iniciar Corretamente

### Opção 1: PM2 com ecosystem.config.js (RECOMENDADO)
```bash
cd /var/www/dex-contabo
pm2 start ecosystem.config.js
pm2 save
```

### Opção 2: PM2 manual
```bash
cd /var/www/dex-contabo
pm2 start api/server.ts --name dex-api --interpreter node --interpreter-args "-r ts-node/register"
```

### Opção 3: npm script
```bash
cd /var/www/dex-contabo
npm run start:prod
```

## 📊 Validação

### Logs esperados ao iniciar:
```
🔄 Loading iFood Auth TypeScript handlers...
✅ iFood Auth TypeScript handlers loaded successfully
🚀 Dex Contabo API (TypeScript) running on http://localhost:3000
📝 Environment: production
🔗 CORS Origin: *
✅ Health check: http://localhost:3000/api/health
🔷 TypeScript: Enabled via ts-node
```

### Teste de health:
```bash
curl https://api.usa-dex.com.br/api/health
```

Resposta esperada:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-07T...",
  "env": "production",
  "typescript": true
}
```

## 🔍 Debugging

### Ver logs do PM2:
```bash
pm2 logs dex-api --lines 100
```

### Ver erros específicos:
```bash
pm2 logs dex-api --err --lines 50
```

### Verificar se ts-node está disponível:
```bash
cd /var/www/dex-contabo
npm list ts-node
```

### Testar handler específico:
```bash
# Link (gerar código)
curl -X POST https://api.usa-dex.com.br/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"111","merchantId":"111"}'

# Status
curl "https://api.usa-dex.com.br/api/ifood-auth/status?accountId=111&scope=reviews"
```

## 📦 Dependências Críticas

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.39.7",
    "@vercel/node": "^3.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "ts-node": "^10.9.2"  // ← CRÍTICO para TypeScript
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

## ✅ Checklist de Migração

- [x] `server.ts` criado e funcional
- [x] Todos os handlers em TypeScript com `export default`
- [x] `tsconfig.json` configurado
- [x] `ecosystem.config.js` com ts-node
- [x] CORS configurado no middleware global
- [x] `.env` correto em `/var/www/dex-contabo/`
- [ ] Deletar arquivos `.js` antigos
- [ ] Remover CORS duplicado dos handlers
- [ ] Testar fluxo completo de vinculação

## 🎯 Próximos Passos

1. **Limpar arquivos antigos**
   ```bash
   cd /var/www/dex-contabo/api/ifood-auth
   rm *.js
   ```

2. **Reiniciar servidor**
   ```bash
   pm2 restart dex-api
   ```

3. **Testar vinculação iFood**
   - Abrir modal de conexão
   - Gerar código
   - Autorizar no Portal iFood
   - Verificar tokens no Supabase
