# 🚨 Ações Imediatas - Resolver Problema de Vínculo iFood

## 📊 Status Atual

✅ **Arquivos base criados** (não precisa fazer do zero!)  
⏳ **Próximo passo**: Validar ambiente e testar

## 🎯 Problema Principal

> "Não consigo vincular as contas com o ifood"

### Causas Prováveis (em ordem de probabilidade)

1. **Variáveis de ambiente faltando ou incorretas** (80% dos casos)
2. **ENCRYPTION_KEY mudou** (tokens corrompidos)
3. **Credenciais iFood inválidas ou expiradas**
4. **Problemas de rede/CORS**
5. **Bugs no código** (menos provável, código está bem implementado)

## ⚡ Ações Imediatas (Execute AGORA)

### 1️⃣ Validar Ambiente (5 minutos)

```bash
# No servidor Contabo
ssh dex@seu-servidor
cd /home/dex/dex-app

# Tornar script executável
chmod +x VALIDATE_ENV.sh

# Executar validação
./VALIDATE_ENV.sh
```

**O que esperar**:
- ✅ Se tudo OK: Pule para passo 2
- ❌ Se falhar: Corrija as variáveis indicadas

**Erros comuns**:
```bash
# Se ENCRYPTION_KEY estiver faltando
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copie o output e adicione ao .env:
echo "ENCRYPTION_KEY=<output-aqui>" >> .env

# Se credenciais iFood estiverem faltando
nano .env
# Adicione:
# IFOOD_CLIENT_ID_REVIEWS=seu-client-id
# IFOOD_CLIENT_SECRET_REVIEWS=seu-client-secret
# IFOOD_CLIENT_ID_FINANCIAL=seu-client-id
# IFOOD_CLIENT_SECRET_FINANCIAL=seu-client-secret
```

### 2️⃣ Verificar Logs do PM2 (2 minutos)

```bash
# Ver últimos erros
pm2 logs dex-api --err --lines 50

# Ver todos os logs
pm2 logs dex-api --lines 100
```

**O que procurar**:
- ❌ `Missing ENCRYPTION_KEY`
- ❌ `Missing iFood credentials`
- ❌ `Failed to decrypt`
- ❌ `Account not found`
- ❌ `401 Unauthorized`

### 3️⃣ Testar Health Check (1 minuto)

```bash
# Localmente
curl http://localhost:3000/api/ifood-auth/health

# Ou via domínio
curl https://seu-dominio.com/api/ifood-auth/health
```

**Resposta esperada**:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-08T...",
  "checks": {
    "supabase": "ok",
    "encryption": "ok",
    "ifood_credentials": "ok"
  }
}
```

### 4️⃣ Testar Fluxo de Vínculo (5 minutos)

```bash
# Usar script de teste
./test-ifood-auth.sh http://localhost:3000 <seu-account-id> reviews
```

**OU manualmente**:

```bash
# 1. Solicitar userCode
curl -X POST http://localhost:3000/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "reviews",
    "storeId": "seu-account-id-aqui"
  }'

# Resposta esperada:
# {
#   "userCode": "ABC123",
#   "verificationUrl": "https://portal.ifood.com.br/...",
#   "authorizationCodeVerifier": "verifier_xyz...",
#   "expiresIn": 600
# }
```

**Se falhar aqui**:
- Verifique logs: `pm2 logs dex-api --err --lines 20`
- Verifique credenciais no .env
- Verifique se account_id existe no banco

## 🔧 Soluções para Problemas Comuns

### Problema: "Missing ENCRYPTION_KEY"

```bash
# Gerar nova chave
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env

# Reiniciar
pm2 restart dex-api

# ⚠️ ATENÇÃO: Isso invalida todos os tokens salvos!
# Todas as contas precisarão re-autenticar
```

### Problema: "Account not found"

```bash
# Verificar se conta existe
psql -h seu-supabase-host -U postgres -d postgres -c \
  "SELECT id, ifood_merchant_id FROM accounts WHERE id = 'seu-uuid';"

# Se não existir, criar conta primeiro no sistema
```

### Problema: "Failed to decrypt token"

**Causa**: ENCRYPTION_KEY mudou ou token corrompido

**Solução**:
```sql
-- Limpar tokens corrompidos (no Supabase SQL Editor)
DELETE FROM ifood_store_auth WHERE account_id = 'seu-account-id';

-- Depois, refazer vínculo
```

### Problema: "iFood API returned 401"

**Causas possíveis**:
1. Credenciais inválidas
2. App iFood não homologado
3. Escopo incorreto

**Verificação**:
```bash
# Testar credenciais diretamente
curl -X POST https://merchant-api.ifood.com.br/authentication/v1.0/oauth/userCode \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "clientId=SEU_CLIENT_ID"

# Se retornar 401: Credenciais inválidas
# Se retornar 200: Credenciais OK, problema é no código
```

## 📝 Checklist de Debug

Execute na ordem:

- [ ] `./VALIDATE_ENV.sh` passou sem erros
- [ ] `pm2 logs` não mostra erros críticos
- [ ] Health check retorna `healthy`
- [ ] POST /link retorna userCode
- [ ] Consegue autorizar no Portal iFood
- [ ] POST /exchange retorna tokens
- [ ] GET /status retorna `connected`

## 🆘 Se Nada Funcionar

### Opção 1: Logs Detalhados

```bash
# Ativar modo debug
echo "NODE_ENV=development" >> .env
pm2 restart dex-api

# Ver logs em tempo real
pm2 logs dex-api --raw

# Tentar vincular e observar logs
```

### Opção 2: Testar Localmente

```bash
# Clonar repo localmente
git clone <seu-repo>
cd dex-contabo

# Copiar .env do servidor
scp dex@seu-servidor:/home/dex/dex-app/.env .env

# Instalar e rodar
npm install
npm run start

# Testar
curl http://localhost:3000/api/ifood-auth/health
```

### Opção 3: Refatorar Gradualmente

Se o código atual está muito confuso:

1. **Não apague nada ainda**
2. **Use os arquivos `.refactored.ts` criados**
3. **Teste lado a lado**
4. **Migre endpoint por endpoint**

```bash
# Exemplo: Testar link refatorado
cp api/ifood-auth/link.refactored.ts api/ifood-auth/link.ts
pm2 restart dex-api
# Testar
```

## 📞 Próximos Passos

1. **Execute validação**: `./VALIDATE_ENV.sh`
2. **Compartilhe resultado**: Me envie o output completo
3. **Compartilhe logs**: `pm2 logs dex-api --err --lines 50`
4. **Teste manualmente**: Tente vincular uma conta e me diga onde falha

## 🎯 Objetivo Final

Conseguir executar este fluxo completo sem erros:

```bash
# 1. Link
curl -X POST http://localhost:3000/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"uuid"}' \
  | jq .

# 2. Autorizar no portal (manual)
# Ir para verificationUrl e inserir userCode

# 3. Exchange
curl -X POST http://localhost:3000/api/ifood-auth/exchange \
  -H "Content-Type: application/json" \
  -d '{
    "scope":"reviews",
    "storeId":"uuid",
    "authorizationCode":"codigo-do-portal",
    "authorizationCodeVerifier":"verifier-do-passo-1"
  }' \
  | jq .

# 4. Status
curl "http://localhost:3000/api/ifood-auth/status?accountId=uuid&scope=reviews" \
  | jq .
```

---

**Execute o passo 1 AGORA e me envie o resultado!** 🚀
