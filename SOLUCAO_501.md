# 🔧 Solução: Erro 501 "Not Implemented - TypeScript compilation"

## Problema Identificado

O servidor Express em produção (`api.usa-dex.com.br`) estava retornando **501 Not Implemented** porque:

1. O arquivo `server.js` tinha endpoints **hardcoded** para retornar 501
2. Não havia suporte para executar arquivos TypeScript (`.ts`) em produção
3. Os handlers existentes (`link.ts`, `exchange.ts`, etc.) não eram carregados

## Causa Raiz

```javascript
// server.js (ANTES - INCORRETO)
app.post('/api/ifood-auth/link', (req, res) => {
  res.status(501).json({ error: 'Not implemented - TypeScript compilation needed' });
});
```

O servidor estava configurado para **sempre** retornar 501, independente das credenciais ou configuração.

## Solução Implementada

### ✅ Mantido 100% TypeScript

Conforme solicitado, **não convertemos para JavaScript**. Em vez disso:

1. **Adicionado `ts-node`** ao `package.json` para executar TypeScript em produção
2. **Criado `server.ts`** que carrega handlers TypeScript diretamente
3. **Atualizado `ecosystem.config.js`** para usar `ts-node/register`
4. **Adicionado `@types`** necessários (express, cors)

### Arquivos Modificados

#### 1. `package.json`
```json
{
  "dependencies": {
    "ts-node": "^10.9.2"  // ← NOVO
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",      // ← NOVO
    "@types/express": "^4.17.21"   // ← NOVO
  },
  "scripts": {
    "start": "ts-node api/server.ts",           // ← NOVO
    "pm2:start": "pm2 start ecosystem.config.js" // ← NOVO
  }
}
```

#### 2. `api/server.ts` (NOVO)
```typescript
// Servidor Express TypeScript
import express from 'express';
import cors from 'cors';

// Carregar handlers TypeScript
const healthHandler = require('./ifood-auth/health').default;
const linkHandler = require('./ifood-auth/link').default;
const exchangeHandler = require('./ifood-auth/exchange').default;
const refreshHandler = require('./ifood-auth/refresh').default;
const statusHandler = require('./ifood-auth/status').default;

// Montar rotas
app.get('/api/ifood-auth/health', adaptVercelHandler(healthHandler));
app.post('/api/ifood-auth/link', adaptVercelHandler(linkHandler));
app.post('/api/ifood-auth/exchange', adaptVercelHandler(exchangeHandler));
app.post('/api/ifood-auth/refresh', adaptVercelHandler(refreshHandler));
app.get('/api/ifood-auth/status', adaptVercelHandler(statusHandler));
```

#### 3. `ecosystem.config.js`
```javascript
module.exports = {
  apps: [{
    name: 'dex-api',
    script: './api/server.ts',              // ← .ts em vez de .js
    interpreter: 'node',
    interpreter_args: '-r ts-node/register', // ← Executa TypeScript
    env: {
      TS_NODE_PROJECT: './tsconfig.json'
    }
  }]
};
```

## Deploy no Servidor

### Passo 1: Atualizar Código

```bash
# SSH no servidor
ssh root@api.usa-dex.com.br

# Navegar e atualizar
cd /var/www/dex-backend/dex-contabo
git pull origin main
```

### Passo 2: Instalar Dependências

```bash
# Instalar ts-node e @types
npm install

# Verificar instalação
npx ts-node --version
```

### Passo 3: Reiniciar Servidor

```bash
# Parar PM2
pm2 stop dex-api

# Iniciar com nova configuração
npm run pm2:start

# Verificar logs
pm2 logs dex-api --lines 50
```

### Passo 4: Validar

```bash
# Testar health check
curl https://api.usa-dex.com.br/api/health

# Testar endpoint de link (não deve mais retornar 501)
curl -X POST https://api.usa-dex.com.br/api/ifood-auth/link?scope=financial \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"111"}'
```

## Resultado Esperado

### ❌ ANTES (501)
```json
{
  "error": "Not implemented - TypeScript compilation needed"
}
```

### ✅ DEPOIS (200 ou erro real)
```json
{
  "userCode": "ABC123",
  "authorizationCodeVerifier": "...",
  "verificationUrl": "https://portal.ifood.com.br/apps/code",
  "verificationUrlComplete": "https://portal.ifood.com.br/apps/code?user_code=ABC123"
}
```

Ou, se houver erro de credenciais:
```json
{
  "error": "iFood credentials not configured"
}
```

**Importante**: Agora os erros serão **reais** (credenciais, rede, etc.), não mais 501 hardcoded.

## Vantagens da Solução

✅ **100% TypeScript** - Mantém type safety em produção  
✅ **Sem build step** - Deploy mais simples (não precisa compilar)  
✅ **Fácil debug** - Stack traces apontam para código TypeScript original  
✅ **Compatível com PM2** - Cluster mode funciona normalmente  
✅ **Hot reload** - Mudanças no código refletem após `pm2 restart`  

## Próximos Passos

1. ✅ Fazer commit e push das mudanças
2. ⏳ SSH no servidor e executar deploy
3. ⏳ Validar que endpoints retornam dados reais (não 501)
4. ⏳ Testar fluxo completo de autenticação no frontend

## Comandos Rápidos

```bash
# No servidor (após SSH)
cd /var/www/dex-backend/dex-contabo
git pull
npm install
pm2 restart dex-api
pm2 logs dex-api

# Validar
curl https://api.usa-dex.com.br/api/health
```

## Documentação Completa

Ver: [`DEPLOY_TYPESCRIPT.md`](./DEPLOY_TYPESCRIPT.md)

---

**Data**: 2025-11-04  
**Problema**: 501 Not Implemented  
**Causa**: Endpoints hardcoded + falta de suporte TypeScript  
**Solução**: ts-node + server.ts + ecosystem.config.js atualizado  
**Status**: ✅ Implementado, aguardando deploy no servidor
