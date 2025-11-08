# 🔧 Guia de Refatoração - Autenticação iFood

## 📋 Objetivo

Estabilizar a autenticação iFood consolidando a lógica em componentes reutilizáveis e eliminando duplicação de código.

## 🎯 Problemas Resolvidos

- ✅ **Credenciais centralizadas**: Lógica de seleção de CLIENT_ID/SECRET em um único lugar
- ✅ **Resolução de IDs unificada**: Função única para resolver accountId/merchantId
- ✅ **Cliente HTTP reutilizável**: Todas as chamadas à API iFood em uma classe
- ✅ **Logs estruturados**: Logger com trace IDs e sanitização de dados sensíveis
- ✅ **Validação de ambiente**: Script automatizado para verificar configuração

## 📁 Arquivos Criados

### 1. `api/_shared/config.ts`
**Responsabilidade**: Configurações centralizadas

```typescript
import { getIFoodCredentials } from './config';

// Obtém credenciais baseado no escopo
const { clientId, clientSecret } = getIFoodCredentials('reviews');
```

**Funções principais**:
- `getIFoodCredentials(scope)`: Retorna credenciais por escopo
- `getIFoodBaseUrl()`: URL base da API iFood
- `validateEnvironment()`: Valida variáveis obrigatórias

### 2. `api/_shared/account-resolver.ts`
**Responsabilidade**: Resolução de identificadores

```typescript
import { resolveAccountId } from './account-resolver';

// Aceita UUID ou merchantId
const account = await resolveAccountId('uuid-ou-merchant-id');
console.log(account.id); // UUID interno
console.log(account.ifood_merchant_id); // merchantId do iFood
```

**Funções principais**:
- `resolveAccountId(identifier)`: Resolve UUID ou merchantId
- `accountExists(identifier)`: Verifica se conta existe
- `resolveMultipleAccounts(ids)`: Resolve múltiplas contas

### 3. `api/_shared/ifood-client.ts`
**Responsabilidade**: Cliente HTTP para API iFood

```typescript
import { ifoodClient } from './ifood-client';

// Solicitar userCode
const userCode = await ifoodClient.requestUserCode('reviews');

// Trocar código por tokens
const tokens = await ifoodClient.exchangeAuthorizationCode(
  'reviews',
  authCode,
  verifier
);

// Refresh token
const newTokens = await ifoodClient.refreshAccessToken('reviews', refreshToken);

// Validar token
const merchant = await ifoodClient.getMerchantInfo(accessToken);
```

**Métodos principais**:
- `requestUserCode(scope)`: Solicita userCode
- `exchangeAuthorizationCode(scope, code, verifier)`: Troca código por tokens
- `refreshAccessToken(scope, refreshToken)`: Renova token
- `getMerchantInfo(accessToken)`: Valida token e obtém merchant
- `resolveMerchantId(tokenData)`: Extrai merchantId com fallbacks

### 4. `api/_shared/enhanced-logger.ts`
**Responsabilidade**: Logging estruturado

```typescript
import { logger } from './enhanced-logger';

logger.info('Iniciando autenticação', {
  traceId: 'abc123',
  accountId: 'uuid',
  scope: 'reviews'
});

logger.error('Falha ao autenticar', error, {
  accountId: 'uuid',
  scope: 'reviews'
});

// Logger com contexto
const scopedLogger = logger.withContext({ scope: 'reviews' });
scopedLogger.info('Token renovado'); // Automaticamente inclui scope
```

**Recursos**:
- Trace IDs automáticos
- Sanitização de dados sensíveis (tokens, senhas)
- Contexto reutilizável
- Formatação consistente

### 5. `VALIDATE_ENV.sh`
**Responsabilidade**: Validação de ambiente

```bash
chmod +x VALIDATE_ENV.sh
./VALIDATE_ENV.sh
```

**Validações**:
- ✅ Variáveis obrigatórias (SUPABASE_URL, ENCRYPTION_KEY, etc)
- ✅ Credenciais iFood (pelo menos um conjunto)
- ✅ Formato da ENCRYPTION_KEY (base64, tamanho)
- ✅ Conexão com Supabase

## 🔄 Próximos Passos - Refatoração dos Endpoints

### Fase 1: Refatorar `link.ts`

**Antes**:
```typescript
// Lógica duplicada de credenciais
const clientId = scope === 'financial'
  ? (process.env.IFOOD_CLIENT_ID_FINANCIAL || process.env.IFOOD_CLIENT_ID)
  : ...
```

**Depois**:
```typescript
import { ifoodClient } from '../_shared/ifood-client';
import { logger } from '../_shared/enhanced-logger';

const data = await ifoodClient.requestUserCode(scope);
logger.info('UserCode gerado', { scope, userCode: data.userCode });
```

### Fase 2: Refatorar `exchange.ts`

**Antes**:
```typescript
// Resolução de ID duplicada
let resolvedAccountId: string | null = null;
if (bodyStoreId) {
  const { data: byId } = await supabase...
}
// ... mais 20 linhas
```

**Depois**:
```typescript
import { resolveAccountId } from '../_shared/account-resolver';
import { ifoodClient } from '../_shared/ifood-client';

const account = await resolveAccountId(storeId);
const tokens = await ifoodClient.exchangeAuthorizationCode(scope, authCode, verifier);
const merchantId = await ifoodClient.resolveMerchantId(tokens);
```

### Fase 3: Refatorar `refresh.ts`

**Antes**:
```typescript
// Lógica de fallback complexa
let { data: authData } = await supabase...
if (!authData) {
  const opposite = wantedScope === 'financial' ? 'reviews' : 'financial';
  // ... mais código
}
```

**Depois**:
```typescript
import { resolveAccountId } from '../_shared/account-resolver';
import { ifoodClient } from '../_shared/ifood-client';
import { decryptFromB64, encryptToB64 } from '../_shared/crypto';

const account = await resolveAccountId(storeId);
const refreshToken = await decryptFromB64(authData.refresh_token);
const tokens = await ifoodClient.refreshAccessToken(scope, refreshToken);
```

### Fase 4: Refatorar `status.ts`

**Antes**:
```typescript
const ifoodResponse = await fetch(`${IFOOD_BASE_URL}/merchant/v1.0/merchants/me`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});
```

**Depois**:
```typescript
import { ifoodClient } from '../_shared/ifood-client';

try {
  const merchant = await ifoodClient.getMerchantInfo(accessToken);
  return { status: 'connected', merchantId: merchant.id };
} catch (error) {
  return { status: 'pending', message: 'Token expired' };
}
```

## 📊 Benefícios da Refatoração

### Antes
- 🔴 Código duplicado em 4 arquivos
- 🔴 Lógica de credenciais repetida
- 🔴 Resolução de IDs inconsistente
- 🔴 Logs sem estrutura
- 🔴 Difícil de debugar

### Depois
- 🟢 Código centralizado e reutilizável
- 🟢 Credenciais em um único lugar
- 🟢 Resolução de IDs unificada
- 🟢 Logs estruturados com trace IDs
- 🟢 Fácil de debugar e testar

## 🧪 Como Testar

### 1. Validar Ambiente
```bash
./VALIDATE_ENV.sh
```

### 2. Testar Localmente
```bash
npm run start
# Em outro terminal
curl http://localhost:3000/api/ifood-auth/health
```

### 3. Testar Fluxo Completo
```bash
./test-ifood-auth.sh http://localhost:3000 <account-id> reviews
```

## 🚀 Deploy no Contabo

### 1. Validar antes do deploy
```bash
ssh dex@seu-servidor
cd /home/dex/dex-app
./VALIDATE_ENV.sh
```

### 2. Deploy via GitHub Actions
```bash
git add .
git commit -m "refactor: centralizar autenticação iFood"
git push origin main
# GitHub Actions fará o deploy automático
```

### 3. Verificar logs
```bash
ssh dex@seu-servidor
pm2 logs dex-api --lines 50
```

## 📝 Checklist de Refatoração

- [ ] Validar ambiente com `./VALIDATE_ENV.sh`
- [ ] Criar arquivos compartilhados (config, account-resolver, ifood-client, logger)
- [ ] Refatorar `link.ts` para usar `ifoodClient`
- [ ] Refatorar `exchange.ts` para usar `resolveAccountId` e `ifoodClient`
- [ ] Refatorar `refresh.ts` para usar `resolveAccountId` e `ifoodClient`
- [ ] Refatorar `status.ts` para usar `ifoodClient`
- [ ] Adicionar logs estruturados em todos os endpoints
- [ ] Testar localmente
- [ ] Deploy no Contabo
- [ ] Validar em produção

## 🐛 Troubleshooting

### Erro: "Missing iFood credentials"
```bash
# Verificar quais credenciais estão configuradas
grep IFOOD_CLIENT_ID .env

# Adicionar credenciais faltando
echo "IFOOD_CLIENT_ID_REVIEWS=seu-client-id" >> .env
echo "IFOOD_CLIENT_SECRET_REVIEWS=seu-client-secret" >> .env
```

### Erro: "Account not found"
```typescript
// Verificar se o identifier está correto
import { accountExists } from './account-resolver';

if (await accountExists(identifier)) {
  console.log('Conta existe');
} else {
  console.log('Conta não encontrada');
}
```

### Erro: "Failed to decrypt token"
```bash
# ENCRYPTION_KEY mudou ou está incorreta
# Solução: Re-autenticar todas as contas
# Ou restaurar ENCRYPTION_KEY original
```

## 📞 Próximos Passos

1. **Executar validação**: `./VALIDATE_ENV.sh`
2. **Revisar arquivos criados**: Entender cada componente
3. **Começar refatoração**: Começar por `link.ts` (mais simples)
4. **Testar incrementalmente**: Testar cada endpoint após refatorar
5. **Deploy gradual**: Deploy e validação em produção

---

**Última atualização**: 2025-01-08  
**Autor**: Dex Team
