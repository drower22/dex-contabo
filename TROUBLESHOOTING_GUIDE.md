# 🔧 Guia de Troubleshooting - API Contabo

## 🚀 Execução Rápida

### 1. Executar Diagnóstico Completo

```bash
# No servidor Contabo, execute:
cd /var/www/dex-contabo
bash DIAGNOSE_SERVER.sh

# Isso gerará um arquivo diagnostic_YYYY-MM-DD_HH-MM-SS.log
# Compartilhe este arquivo para análise detalhada
```

---

## 🔍 Problemas Comuns e Soluções

### ❌ Problema 1: API não responde (502 Bad Gateway / Connection Refused)

**Sintomas:**
- Erro 502 ao acessar `https://api.usa-dex.com.br`
- `curl localhost:3000` falha
- Nginx retorna "Connection refused"

**Diagnóstico:**
```bash
# Verificar se o processo está rodando
pm2 list

# Verificar porta 3000
sudo lsof -i :3000
```

**Soluções:**

#### A) Processo PM2 não está rodando
```bash
cd /var/www/dex-contabo
pm2 start ecosystem.config.js
pm2 save
```

#### B) Processo crashando constantemente
```bash
# Ver logs de erro
pm2 logs dex-api --err --lines 100

# Problemas comuns:
# - Falta de .env → criar .env (ver seção abaixo)
# - Falta de node_modules → npm install
# - Erro de sintaxe → verificar código
# - Porta em uso → matar processo: sudo kill -9 $(sudo lsof -t -i:3000)
```

#### C) Reiniciar completamente
```bash
pm2 delete dex-api
cd /var/www/dex-contabo
npm install
pm2 start ecosystem.config.js
pm2 save
```

---

### ❌ Problema 2: Erro "Missing ENCRYPTION_KEY"

**Sintomas:**
- Logs mostram: `Missing ENCRYPTION_KEY`
- Health check retorna `unhealthy`
- Endpoints de auth falham

**Solução:**
```bash
cd /var/www/dex-contabo

# 1. Gerar chave de criptografia
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "ENCRYPTION_KEY gerada: $ENCRYPTION_KEY"

# 2. Adicionar ao .env
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env

# 3. Reiniciar
pm2 restart dex-api
```

---

### ❌ Problema 3: Arquivo .env não existe

**Sintomas:**
- Variáveis de ambiente não carregam
- Erros de "Missing SUPABASE_URL", "Missing ENCRYPTION_KEY", etc.

**Solução:**
```bash
cd /var/www/dex-contabo

# 1. Copiar template
cp env.example .env

# 2. Gerar chaves
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
echo "CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# 3. Editar .env com suas credenciais
nano .env

# Cole e preencha:
# SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=eyJ...
# ENCRYPTION_KEY=... (usar a gerada acima)
# IFOOD_CLIENT_ID_REVIEWS=...
# IFOOD_CLIENT_SECRET_REVIEWS=...
# IFOOD_CLIENT_ID_FINANCIAL=...
# IFOOD_CLIENT_SECRET_FINANCIAL=...
# CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# 4. Reiniciar
pm2 restart dex-api
```

---

### ❌ Problema 4: CORS Error no Frontend

**Sintomas:**
- Console do navegador: `Access to fetch at 'https://api.usa-dex.com.br' has been blocked by CORS policy`
- Requisições OPTIONS retornam erro

**Diagnóstico:**
```bash
# Testar CORS headers
curl -I -X OPTIONS https://api.usa-dex.com.br/api/ifood-auth/health \
  -H "Origin: https://dex-parceiros-api-ifood-nxij.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

**Solução A: Configurar CORS_ORIGIN no .env**
```bash
cd /var/www/dex-contabo
nano .env

# Adicionar/atualizar:
CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app

# Ou múltiplas origens:
CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app,http://localhost:5173

pm2 restart dex-api
```

**Solução B: Configurar Nginx (se CORS ainda falhar)**
```bash
# Editar configuração do Nginx
sudo nano /etc/nginx/sites-enabled/api.usa-dex.com.br

# Adicionar dentro do bloco location /:
location / {
    # CORS headers
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;

    # Preflight
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '$http_origin' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization' always;
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain charset=UTF-8';
        add_header 'Content-Length' 0;
        return 204;
    }

    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}

# Testar e recarregar
sudo nginx -t
sudo systemctl reload nginx
```

---

### ❌ Problema 5: Health Check retorna "unhealthy"

**Sintomas:**
- `/api/ifood-auth/health` retorna `status: "unhealthy"`
- Alguns checks falham

**Diagnóstico:**
```bash
# Testar health check
curl -s http://localhost:3000/api/ifood-auth/health | jq

# Verificar quais checks falharam:
# - supabase: false → problema com SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY
# - encryption: false → problema com ENCRYPTION_KEY
# - ifood_reviews: false → problema com IFOOD_CLIENT_ID_REVIEWS
# - ifood_financial: false → problema com IFOOD_CLIENT_ID_FINANCIAL
```

**Soluções por check:**

#### supabase: false
```bash
# Verificar variáveis
cd /var/www/dex-contabo
grep SUPABASE .env

# Testar conexão manualmente
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('accounts').select('id').limit(1).then(console.log);
"
```

#### encryption: false
```bash
# Gerar nova chave
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
pm2 restart dex-api
```

#### ifood_reviews: false ou ifood_financial: false
```bash
# Verificar credenciais iFood
cd /var/www/dex-contabo
grep IFOOD_CLIENT .env

# Testar credenciais manualmente
curl -X POST https://merchant-api.ifood.com.br/authentication/v1.0/oauth/userCode \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "clientId=SEU_CLIENT_ID_AQUI"

# Se retornar 200 ou 400 = credenciais válidas
# Se retornar 401 = credenciais inválidas
```

---

### ❌ Problema 6: node_modules não existe

**Sintomas:**
- Erro: `Cannot find module '@supabase/supabase-js'`
- Erro: `Cannot find module 'express'`

**Solução:**
```bash
cd /var/www/dex-contabo
npm install
pm2 restart dex-api
```

---

### ❌ Problema 7: Nginx não está rodando

**Sintomas:**
- `curl https://api.usa-dex.com.br` falha
- Porta 80/443 não está em uso

**Solução:**
```bash
# Verificar status
sudo systemctl status nginx

# Se não estiver rodando
sudo systemctl start nginx

# Se configuração inválida
sudo nginx -t
# Corrigir erros apontados
sudo systemctl restart nginx

# Habilitar auto-start
sudo systemctl enable nginx
```

---

### ❌ Problema 8: Certificado SSL expirado/inválido

**Sintomas:**
- Erro SSL no navegador
- `curl https://api.usa-dex.com.br` retorna erro de certificado

**Solução (Certbot/Let's Encrypt):**
```bash
# Renovar certificado
sudo certbot renew

# Ou forçar renovação
sudo certbot renew --force-renewal

# Recarregar Nginx
sudo systemctl reload nginx

# Verificar validade
echo | openssl s_client -servername api.usa-dex.com.br -connect api.usa-dex.com.br:443 2>&1 | grep -A 2 "Verify return code"
```

---

### ❌ Problema 9: Logs não aparecem

**Sintomas:**
- `pm2 logs` não mostra nada
- Difícil debugar problemas

**Solução:**
```bash
# Verificar diretório de logs
cd /var/www/dex-contabo
ls -la logs/

# Se não existir, criar
mkdir -p logs

# Reiniciar PM2
pm2 restart dex-api

# Ver logs em tempo real
pm2 logs dex-api --lines 100
```

---

### ❌ Problema 10: Memória insuficiente (OOM)

**Sintomas:**
- Processo PM2 reinicia constantemente
- Logs mostram: "JavaScript heap out of memory"

**Solução:**
```bash
# Aumentar limite de memória no ecosystem.config.js
cd /var/www/dex-contabo
nano ecosystem.config.js

# Alterar:
max_memory_restart: '1G',  # Aumentar de 500M para 1G

# Ou adicionar flag Node:
node_args: '--max-old-space-size=1024',

# Reiniciar
pm2 delete dex-api
pm2 start ecosystem.config.js
pm2 save
```

---

## 📊 Comandos Úteis de Monitoramento

### Monitorar em tempo real
```bash
# Logs em tempo real
pm2 logs dex-api

# Monitorar recursos (CPU, memória)
pm2 monit

# Status detalhado
pm2 describe dex-api

# Logs do Nginx em tempo real
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Verificar performance
```bash
# Testar latência
time curl -s http://localhost:3000/api/ifood-auth/health > /dev/null

# Testar carga (10 requisições simultâneas)
ab -n 100 -c 10 http://localhost:3000/api/ifood-auth/health
```

---

## 🔄 Procedimento de Restart Completo

Se nada funcionar, execute este procedimento completo:

```bash
# 1. Parar tudo
pm2 delete dex-api
sudo systemctl stop nginx

# 2. Limpar processos na porta 3000
sudo kill -9 $(sudo lsof -t -i:3000) 2>/dev/null || true

# 3. Ir para o diretório do projeto
cd /var/www/dex-contabo

# 4. Atualizar código (se necessário)
git pull origin main

# 5. Reinstalar dependências
rm -rf node_modules package-lock.json
npm install

# 6. Verificar .env
ls -la .env
# Se não existir, criar conforme Problema 3

# 7. Testar localmente
node api/server.ts &
sleep 5
curl http://localhost:3000/api/ifood-auth/health
kill %1

# 8. Iniciar PM2
pm2 start ecosystem.config.js
pm2 save

# 9. Iniciar Nginx
sudo nginx -t
sudo systemctl start nginx

# 10. Verificar
pm2 list
sudo systemctl status nginx
curl https://api.usa-dex.com.br/api/ifood-auth/health
```

---

## 📞 Checklist de Verificação

Antes de pedir ajuda, verifique:

- [ ] PM2 está instalado: `pm2 -v`
- [ ] Processo dex-api está rodando: `pm2 list`
- [ ] Porta 3000 está em uso: `sudo lsof -i :3000`
- [ ] Nginx está rodando: `sudo systemctl status nginx`
- [ ] Nginx configuração válida: `sudo nginx -t`
- [ ] Arquivo .env existe: `ls -la /var/www/dex-contabo/.env`
- [ ] node_modules existe: `ls -la /var/www/dex-contabo/node_modules`
- [ ] Health check local funciona: `curl http://localhost:3000/api/ifood-auth/health`
- [ ] Health check externo funciona: `curl https://api.usa-dex.com.br/api/ifood-auth/health`
- [ ] Logs do PM2 não mostram erros: `pm2 logs dex-api --lines 50`
- [ ] Logs do Nginx não mostram erros: `sudo tail -n 50 /var/log/nginx/error.log`

---

## 🆘 Suporte Adicional

Se o problema persistir após seguir este guia:

1. Execute o script de diagnóstico:
   ```bash
   bash DIAGNOSE_SERVER.sh
   ```

2. Compartilhe o arquivo `diagnostic_*.log` gerado

3. Inclua informações adicionais:
   - Qual endpoint está falhando?
   - Qual erro aparece no navegador/console?
   - Quando o problema começou?
   - O que mudou recentemente?

---

**Última atualização**: 2025-01-07
