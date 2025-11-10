# CORREÇÃO URGENTE

## Problema
O iFood espera `clientId` (camelCase) mas estamos enviando `client_id` (snake_case)

## Arquivo: api/ifood-auth/link.ts

### Linha 71 - TROCAR:
```typescript
const requestBody = new URLSearchParams({
  client_id: clientId,  // ❌ ERRADO
});
```

### POR:
```typescript
const requestBody = new URLSearchParams({
  clientId: clientId,  // ✅ CORRETO
});
```

## Também corrigir em:
- api/ifood-auth/exchange.ts (linhas com grant_type, client_id, client_secret, etc)
- api/ifood-auth/refresh.ts (linhas com grant_type, client_id, client_secret, refresh_token)

## Padrão correto para iFood OAuth:
- `clientId` (não `client_id`)
- `clientSecret` (não `client_secret`)  
- `grantType` (não `grant_type`)
- `authorizationCode` (não `authorization_code`)
- `authorizationCodeVerifier` (não `authorization_code_verifier`)
- `refreshToken` (não `refresh_token`)
