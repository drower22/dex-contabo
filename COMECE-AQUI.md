# 🚀 COMECE AQUI - Deploy Imediato

## ⚡ Execute estes comandos AGORA (copie e cole)

### 1️⃣ Instalar Dependências

```bash
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"
npm install
```

### 2️⃣ Gerar Chaves de Segurança

```bash
# Gerar ENCRYPTION_KEY
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"

# Gerar CRON_SECRET
echo "CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# ⚠️ COPIE E GUARDE ESTAS CHAVES!
```

### 3️⃣ Criar Arquivo .env

```bash
cp env.example .env
nano .env
```

**Cole e preencha:**
```env
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Pegar do Supabase
ENCRYPTION_KEY=...  # Usar a chave gerada acima
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...  # Criar no Discord
CRON_SECRET=...  # Usar o secret gerado acima
IFOOD_CLIENT_ID_REVIEWS=...  # Suas credenciais iFood
IFOOD_CLIENT_SECRET_REVIEWS=...
IFOOD_CLIENT_ID_FINANCIAL=...
IFOOD_CLIENT_SECRET_FINANCIAL=...
CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app
```

### 4️⃣ Testar Localmente

```bash
# Rodar servidor de dev
npm run dev &

# Aguardar 5 segundos
sleep 5

# Testar health check
curl http://localhost:3000/api/ifood-auth/health | jq

# Deve retornar: "status": "healthy"
```

### 5️⃣ Rodar Testes

```bash
# Rodar todos os testes
npm test

# Se tudo passar, você verá:
# ✓ tests/crypto.test.ts (5)
# ✓ tests/health.test.ts (4)
```

### 6️⃣ Deploy no Vercel

```bash
# Instalar Vercel CLI (se não tiver)
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### 7️⃣ Configurar Variáveis no Vercel

```bash
# Adicionar todas as variáveis
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ENCRYPTION_KEY production
vercel env add DISCORD_WEBHOOK_URL production
vercel env add CRON_SECRET production
vercel env add IFOOD_CLIENT_ID_REVIEWS production
vercel env add IFOOD_CLIENT_SECRET_REVIEWS production
vercel env add IFOOD_CLIENT_ID_FINANCIAL production
vercel env add IFOOD_CLIENT_SECRET_FINANCIAL production
vercel env add CORS_ORIGIN production

# Re-deploy após configurar
vercel --prod
```

### 8️⃣ Validar Deploy

```bash
# Pegar URL do deploy
DEPLOY_URL=$(vercel ls --prod | grep https | awk '{print $2}' | head -1)
echo "Deploy URL: $DEPLOY_URL"

# Testar health check
curl $DEPLOY_URL/api/ifood-auth/health | jq

# Deve retornar: "status": "healthy"
```

---

## 🎯 CHECKLIST

Marque conforme for completando:

- [ ] Dependências instaladas (`npm install`)
- [ ] Chaves geradas (ENCRYPTION_KEY + CRON_SECRET)
- [ ] Arquivo .env criado e preenchido
- [ ] Testes locais passando (`npm test`)
- [ ] Health check local OK (`curl localhost:3000/api/ifood-auth/health`)
- [ ] Vercel CLI instalado (`npm i -g vercel`)
- [ ] Deploy feito (`vercel --prod`)
- [ ] Variáveis configuradas no Vercel
- [ ] Health check produção OK
- [ ] Discord recebendo notificações

---

## 🆘 SE ALGO DER ERRADO

### Erro: "Cannot find module 'vitest'"

```bash
npm install
```

### Erro: "Missing ENCRYPTION_KEY"

```bash
# Gerar chave
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Adicionar no .env
echo "ENCRYPTION_KEY=SUA_CHAVE_AQUI" >> .env
```

### Erro: "Health check unhealthy"

```bash
# Ver detalhes
curl http://localhost:3000/api/ifood-auth/health | jq

# Verificar .env
cat .env

# Verificar logs
npm run dev
```

### Erro: "Discord não recebe notificações"

1. Vá no Discord → Configurações do Servidor → Integrações → Webhooks
2. Criar Novo Webhook
3. Copiar URL
4. Adicionar no .env:
   ```bash
   echo "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/..." >> .env
   ```
5. Testar:
   ```bash
   curl -X POST "https://discord.com/api/webhooks/..." \
     -H "Content-Type: application/json" \
     -d '{"content":"Teste"}'
   ```

---

## 📞 PRECISA DE AJUDA?

1. **Leia o README**: `cat README.md`
2. **Leia o DEPLOY**: `cat DEPLOY.md`
3. **Leia o RESUMO**: `cat RESUMO.md`
4. **Ver logs**: `vercel logs --prod`

---

## ✅ APÓS COMPLETAR

Você terá:

- ✅ Backend TypeScript rodando no Vercel
- ✅ Testes automatizados com notificações Discord
- ✅ Cron jobs renovando tokens a cada 6 horas
- ✅ Health check monitorando a cada 15 minutos
- ✅ Alertas automáticos no Discord
- ✅ Documentação completa

🎉 **PARABÉNS! Sistema pronto para produção!**

---

**Próximo passo**: Testar fluxo completo de autenticação

```bash
./test-ifood-auth.sh $DEPLOY_URL uuid-da-conta reviews
```
