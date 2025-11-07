# 📋 Template Completo do .env para o Backend Contabo

## ⚠️ IMPORTANTE: Seu .env atual está INCOMPLETO!

Você só tem:
```
SUPABASE_URL=https://...
SUPABASE_KEY=...
```

Mas o backend precisa de **TODAS** estas variáveis:

## 🔧 .env Completo Necessário

```bash
# ============================================
# SUPABASE (Banco de Dados)
# ============================================
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...seu_token_completo_aqui...

# ============================================
# IFOOD API - Credenciais OAuth
# ============================================
# App 1: Reviews (merchant + reviews)
IFOOD_CLIENT_ID=seu_client_id_reviews_aqui
IFOOD_CLIENT_SECRET=seu_client_secret_reviews_aqui

# App 2: Financial (merchant + financial)
IFOOD_CLIENT_ID_FINANCIAL=seu_client_id_financial_aqui
IFOOD_CLIENT_SECRET_FINANCIAL=seu_client_secret_financial_aqui

# URL base da API do iFood (opcional, padrão: https://merchant-api.ifood.com.br)
IFOOD_BASE_URL=https://merchant-api.ifood.com.br
IFOOD_API_URL=https://merchant-api.ifood.com.br

# ============================================
# CORS (Controle de Acesso)
# ============================================
# Para desenvolvimento: aceitar qualquer origem
CORS_ORIGIN=*

# Para produção: especificar origens permitidas (separadas por vírgula)
# CORS_ORIGIN=http://localhost:5173,https://dex-parceiros-api-ifood-nxij.vercel.app

# ============================================
# SERVIDOR
# ============================================
PORT=3000
NODE_ENV=production

# ============================================
# CRIPTOGRAFIA (para tokens sensíveis)
# ============================================
# Chave de 32 bytes em hexadecimal para criptografar tokens no banco
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=sua_chave_de_32_bytes_em_hex_aqui

# ============================================
# DISCORD (Notificações - Opcional)
# ============================================
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# ============================================
# AI/OPENAI (Opcional - para recursos de IA)
# ============================================
OPENAI_API_KEY=sk-...
```

## 🚨 Variáveis OBRIGATÓRIAS (mínimo para funcionar)

```bash
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
IFOOD_CLIENT_ID=...
IFOOD_CLIENT_SECRET=...
IFOOD_CLIENT_ID_FINANCIAL=...
IFOOD_CLIENT_SECRET_FINANCIAL=...
CORS_ORIGIN=*
ENCRYPTION_KEY=...
```

## 📝 Como obter cada variável

### 1. SUPABASE (você já tem)
- ✅ `SUPABASE_URL`: https://seibcrrxlyxfqudrrage.supabase.co
- ✅ `SUPABASE_SERVICE_ROLE_KEY`: Já está no seu .env

### 2. IFOOD_CLIENT_ID e SECRET
Você precisa de **2 apps** no Portal do Parceiro iFood:

#### App 1: Reviews
- Acesse: https://portal.ifood.com.br/
- Vá em: Configurações → Integrações → Criar Nova Integração
- Escopos: `merchant.read` + `reviews.read` + `reviews.write`
- Copie: `Client ID` e `Client Secret`

#### App 2: Financial
- Crie outra integração
- Escopos: `merchant.read` + `financial.read`
- Copie: `Client ID` e `Client Secret`

### 3. ENCRYPTION_KEY
Gere uma chave aleatória:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. CORS_ORIGIN
Para desenvolvimento:
```bash
CORS_ORIGIN=*
```

Para produção (mais seguro):
```bash
CORS_ORIGIN=http://localhost:5173,https://dex-parceiros-api-ifood-nxij.vercel.app
```

## 🔄 Como atualizar o .env no servidor

1. **Conecte ao servidor:**
   ```bash
   ssh dex@api.usa-dex.com.br
   ```

2. **Edite o .env:**
   ```bash
   cd /home/dex/dex-app
   nano .env
   ```

3. **Cole o template completo** e preencha os valores

4. **Salve** (Ctrl+O, Enter, Ctrl+X)

5. **Reinicie o servidor:**
   ```bash
   pm2 restart dex-api
   ```

6. **Verifique os logs:**
   ```bash
   pm2 logs dex-api --lines 50
   ```

## ⚠️ Erros comuns se o .env estiver incompleto

- ❌ `IFOOD_CLIENT_ID is not defined`
- ❌ `SUPABASE_SERVICE_ROLE_KEY is not defined`
- ❌ `Cannot read property 'IFOOD_CLIENT_SECRET' of undefined`
- ❌ CORS bloqueando requisições
- ❌ Erro ao criptografar/descriptografar tokens

## ✅ Validação

Após preencher o .env completo, teste:

```bash
# No servidor
curl http://localhost:3000/api/health

# Deve retornar:
{
  "status": "healthy",
  "timestamp": "...",
  "env": "production",
  "typescript": true
}
```

## 📦 Backup

Sempre faça backup antes de editar:
```bash
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
```

## 🆘 Precisa de ajuda?

Se não tiver as credenciais do iFood:
1. Acesse o Portal do Parceiro iFood
2. Crie as 2 integrações (reviews + financial)
3. Copie os Client IDs e Secrets
4. Cole no .env

Se não souber onde está o .env atual:
```bash
ssh dex@api.usa-dex.com.br
cd /home/dex/dex-app
cat .env
```
