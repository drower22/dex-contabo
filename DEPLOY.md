# 🚀 Guia de Deploy - Dex Contabo

## ⚡ Deploy Rápido (5 minutos)

### 1. Preparação

```bash
# Clone o repositório (se ainda não tiver)
cd dex-contabo

# Instale dependências
npm install

# Gere ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copie o output: exemplo: 8vK9xJ2mP4nQ7rS1tU3vW5xY6zA8bC0dE2fG4hI6jK8=

# Gere CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copie o output
```

### 2. Deploy no Vercel

```bash
# Instalar Vercel CLI (se não tiver)
npm i -g vercel

# Login
vercel login

# Link ao projeto
vercel link

# Adicionar variáveis de ambiente
vercel env add SUPABASE_URL production
# Cole: https://seibcrrxlyxfqudrrage.supabase.co

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Cole a service role key do Supabase

vercel env add ENCRYPTION_KEY production
# Cole a chave gerada no passo 1

vercel env add IFOOD_CLIENT_ID_REVIEWS production
# Cole o client ID do app reviews

vercel env add IFOOD_CLIENT_SECRET_REVIEWS production
# Cole o client secret do app reviews

vercel env add IFOOD_CLIENT_ID_FINANCIAL production
# Cole o client ID do app financial

vercel env add IFOOD_CLIENT_SECRET_FINANCIAL production
# Cole o client secret do app financial

vercel env add DISCORD_WEBHOOK_URL production
# Cole a URL do webhook do Discord

vercel env add CRON_SECRET production
# Cole o secret gerado no passo 1

vercel env add CORS_ORIGIN production
# Cole: https://dex-parceiros-api-ifood-nxij.vercel.app

# Deploy!
vercel --prod
```

### 3. Validar Deploy

```bash
# Pegar a URL do deploy
DEPLOY_URL=$(vercel ls --prod | grep https | awk '{print $2}' | head -1)

# Testar health check
curl $DEPLOY_URL/api/ifood-auth/health

# Deve retornar:
# {
#   "status": "healthy",
#   "checks": {
#     "supabase": true,
#     "encryption": true,
#     "ifood_reviews": true,
#     "ifood_financial": true
#   }
# }
```

### 4. Configurar Discord

1. Abra seu servidor Discord
2. Vá em **Configurações do Servidor** → **Integrações** → **Webhooks**
3. Clique em **Novo Webhook**
4. Nome: **Dex Alerts**
5. Canal: Escolha onde quer receber alertas
6. Copie a **URL do Webhook**
7. Configure no Vercel (já feito no passo 2)

### 5. Testar Notificações

```bash
# Testar webhook diretamente
curl -X POST "SEU_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"🚀 Deploy do Dex Contabo concluído com sucesso!"}'

# Deve aparecer mensagem no Discord
```

## 🔄 Atualizar Deploy

```bash
# Fazer mudanças no código
git add .
git commit -m "feat: nova funcionalidade"
git push

# Deploy automático via GitHub
# OU manualmente:
vercel --prod
```

## 🧪 Testar Localmente Antes do Deploy

```bash
# Criar .env local
cp env.template .env

# Editar .env com suas credenciais
nano .env

# Rodar localmente
npm run dev

# Em outro terminal, testar
curl http://localhost:3000/api/ifood-auth/health

# Rodar testes
npm test
```

## 📊 Monitorar Após Deploy

### 1. Verificar Logs

```bash
# Logs em tempo real
vercel logs --follow

# Logs de produção
vercel logs --prod
```

### 2. Verificar Cron Jobs

No dashboard do Vercel:
1. Vá em **Settings** → **Cron Jobs**
2. Verifique se os 2 jobs estão ativos:
   - `refresh-tokens` (a cada 6 horas)
   - `health-check` (a cada 15 minutos)

### 3. Monitorar Discord

Você deve receber notificações a cada 15 minutos do health check.

Se não receber, verifique:
```bash
# Verificar variável
vercel env ls

# Testar endpoint de health
curl https://seu-app.vercel.app/api/cron/health-check \
  -H "Authorization: Bearer SEU_CRON_SECRET"
```

## 🐛 Troubleshooting

### Deploy falhou

```bash
# Ver logs de build
vercel logs

# Verificar se vercel.json está correto
cat vercel.json

# Tentar build local
vercel build
```

### Health check retorna unhealthy

```bash
# Ver detalhes
curl https://seu-app.vercel.app/api/ifood-auth/health | jq

# Verificar variáveis
vercel env ls

# Verificar logs
vercel logs --prod | grep error
```

### Discord não recebe notificações

```bash
# Testar webhook manualmente
curl -X POST "https://discord.com/api/webhooks/..." \
  -H "Content-Type: application/json" \
  -d '{"content":"Teste"}'

# Verificar se DISCORD_WEBHOOK_URL está configurada
vercel env get DISCORD_WEBHOOK_URL

# Verificar logs do cron
vercel logs --prod | grep cron
```

### Testes falhando

```bash
# Instalar dependências
npm install

# Verificar TypeScript
npm run type-check

# Rodar testes com verbose
npm test -- --reporter=verbose

# Verificar se .env existe
ls -la .env
```

## 🔐 Segurança

### Rotação de ENCRYPTION_KEY

⚠️ **ATENÇÃO**: Mudar a ENCRYPTION_KEY invalida todos os tokens salvos!

```bash
# 1. Gerar nova chave
NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# 2. Avisar usuários para re-autenticar

# 3. Atualizar no Vercel
vercel env rm ENCRYPTION_KEY production
vercel env add ENCRYPTION_KEY production
# Cole a nova chave

# 4. Re-deploy
vercel --prod
```

### Rotação de CRON_SECRET

```bash
# 1. Gerar novo secret
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 2. Atualizar no Vercel
vercel env rm CRON_SECRET production
vercel env add CRON_SECRET production
# Cole o novo secret

# 3. Re-deploy
vercel --prod
```

## 📈 Próximos Passos

Após deploy bem-sucedido:

1. ✅ **Testar fluxo completo de autenticação**
   ```bash
   ./test-ifood-auth.sh https://seu-app.vercel.app uuid-teste reviews
   ```

2. ✅ **Configurar CI/CD** (opcional)
   - Criar `.github/workflows/test.yml`
   - Rodar testes automaticamente em PRs

3. ✅ **Monitorar métricas**
   - Dashboard do Vercel
   - Logs do Discord
   - Queries SQL no Supabase

4. ✅ **Documentar para o time**
   - Compartilhar URL do deploy
   - Compartilhar credenciais (vault seguro)
   - Treinar equipe no fluxo

## 🎯 Checklist Final

Antes de considerar o deploy completo:

- [ ] Health check retorna `healthy`
- [ ] Discord recebe notificações
- [ ] Cron jobs estão ativos
- [ ] Fluxo de autenticação testado
- [ ] Testes automatizados passando
- [ ] Logs sem erros críticos
- [ ] Variáveis de ambiente configuradas
- [ ] CORS configurado corretamente
- [ ] Documentação atualizada
- [ ] Time treinado

---

**Dúvidas?** Consulte o [README.md](./README.md) ou a [documentação completa](./IFOOD_AUTH_VALIDATION.md).
