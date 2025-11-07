# 🔍 Como Debugar a API no Servidor Contabo

## 📋 Passo a Passo

### 1️⃣ Conectar ao Servidor

```bash
# SSH no servidor Contabo
ssh usuario@api.usa-dex.com.br
# ou
ssh usuario@IP_DO_SERVIDOR
```

### 2️⃣ Ir para o Diretório do Projeto

```bash
cd /var/www/dex-contabo
```

### 3️⃣ Executar Diagnóstico Completo

```bash
# Baixar/atualizar os scripts de diagnóstico
git pull origin main

# Dar permissão de execução
chmod +x DIAGNOSE_SERVER.sh QUICK_FIX.sh

# Executar diagnóstico
bash DIAGNOSE_SERVER.sh
```

**Resultado:** Será gerado um arquivo `diagnostic_YYYY-MM-DD_HH-MM-SS.log` com todas as informações.

### 4️⃣ Analisar o Log

```bash
# Ver o último log gerado
ls -lt diagnostic_*.log | head -1

# Ler o log
less diagnostic_YYYY-MM-DD_HH-MM-SS.log

# Ou buscar por problemas específicos
grep "❌" diagnostic_*.log
```

### 5️⃣ Aplicar Correção Rápida (se necessário)

```bash
# Executar script de correção automática
bash QUICK_FIX.sh
```

Este script irá:
- ✅ Verificar PM2
- ✅ Verificar dependências (node_modules)
- ✅ Verificar/criar .env
- ✅ Gerar chaves de segurança se necessário
- ✅ Limpar porta 3000
- ✅ Reiniciar processo PM2
- ✅ Testar health check
- ✅ Verificar Nginx

---

## 🎯 Comandos Rápidos de Diagnóstico

### Status Geral
```bash
# Ver processos PM2
pm2 list

# Ver detalhes do processo
pm2 describe dex-api

# Ver logs em tempo real
pm2 logs dex-api

# Ver apenas erros
pm2 logs dex-api --err --lines 100
```

### Testar API
```bash
# Health check local
curl http://localhost:3000/api/ifood-auth/health | jq

# Health check externo
curl https://api.usa-dex.com.br/api/ifood-auth/health | jq

# Testar com verbose
curl -v http://localhost:3000/api/ifood-auth/health
```

### Verificar Portas
```bash
# Ver o que está usando a porta 3000
sudo lsof -i :3000

# Ver todas as portas em uso
sudo netstat -tulpn | grep LISTEN
```

### Verificar Nginx
```bash
# Status do Nginx
sudo systemctl status nginx

# Testar configuração
sudo nginx -t

# Ver logs de erro
sudo tail -f /var/log/nginx/error.log

# Ver logs de acesso
sudo tail -f /var/log/nginx/access.log
```

### Verificar Variáveis de Ambiente
```bash
# Ver variáveis configuradas (sem valores sensíveis)
cd /var/www/dex-contabo
grep -v "^#" .env | grep -v "^$" | cut -d'=' -f1
```

---

## 🔧 Correções Comuns

### Problema: API não responde (502)

```bash
# 1. Verificar se processo está rodando
pm2 list

# 2. Se não estiver, iniciar
cd /var/www/dex-contabo
pm2 start ecosystem.config.js
pm2 save

# 3. Se estiver crashando, ver logs
pm2 logs dex-api --err --lines 50
```

### Problema: Missing ENCRYPTION_KEY

```bash
cd /var/www/dex-contabo

# Gerar chave
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# Adicionar ao .env
echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env

# Reiniciar
pm2 restart dex-api
```

### Problema: CORS Error

```bash
cd /var/www/dex-contabo

# Verificar CORS_ORIGIN no .env
grep CORS_ORIGIN .env

# Se não existir ou estiver errado, adicionar/corrigir
nano .env
# Adicionar: CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app

# Reiniciar
pm2 restart dex-api
```

### Problema: node_modules não existe

```bash
cd /var/www/dex-contabo
npm install
pm2 restart dex-api
```

### Problema: Nginx não está rodando

```bash
# Iniciar Nginx
sudo systemctl start nginx

# Verificar status
sudo systemctl status nginx

# Se houver erro de configuração
sudo nginx -t
```

---

## 📊 Monitoramento Contínuo

### Logs em Tempo Real
```bash
# Terminal 1: Logs da API
pm2 logs dex-api

# Terminal 2: Logs do Nginx
sudo tail -f /var/log/nginx/error.log

# Terminal 3: Monitorar recursos
pm2 monit
```

### Verificar Performance
```bash
# CPU e memória do processo
pm2 describe dex-api | grep -A 5 "Monit"

# Uso geral do sistema
htop
# ou
top
```

---

## 🚨 Restart Completo (Último Recurso)

Se nada funcionar, execute este procedimento:

```bash
# 1. Parar tudo
pm2 delete dex-api
sudo systemctl stop nginx

# 2. Limpar porta 3000
sudo kill -9 $(sudo lsof -t -i:3000) 2>/dev/null || true

# 3. Ir para o projeto
cd /var/www/dex-contabo

# 4. Atualizar código
git pull origin main

# 5. Reinstalar dependências
rm -rf node_modules package-lock.json
npm install

# 6. Verificar .env
ls -la .env
# Se não existir, criar (ver TROUBLESHOOTING_GUIDE.md)

# 7. Iniciar PM2
pm2 start ecosystem.config.js
pm2 save

# 8. Iniciar Nginx
sudo nginx -t
sudo systemctl start nginx

# 9. Verificar
pm2 list
curl http://localhost:3000/api/ifood-auth/health
curl https://api.usa-dex.com.br/api/ifood-auth/health
```

---

## 📤 Compartilhar Logs para Análise

### Opção 1: Copiar log de diagnóstico
```bash
# Gerar diagnóstico
bash DIAGNOSE_SERVER.sh

# Copiar para sua máquina local (executar na sua máquina)
scp usuario@api.usa-dex.com.br:/var/www/dex-contabo/diagnostic_*.log ./
```

### Opção 2: Usar pastebin
```bash
# Instalar pastebinit (se necessário)
sudo apt-get install pastebinit

# Enviar log
cat diagnostic_*.log | pastebinit
# Compartilhe a URL gerada
```

### Opção 3: Copiar manualmente
```bash
# Ver log
cat diagnostic_*.log

# Copiar e colar em um arquivo local ou gist
```

---

## 🎓 Comandos Essenciais PM2

```bash
# Listar processos
pm2 list

# Ver detalhes
pm2 describe dex-api

# Logs
pm2 logs dex-api
pm2 logs dex-api --lines 100
pm2 logs dex-api --err

# Reiniciar
pm2 restart dex-api

# Parar
pm2 stop dex-api

# Deletar
pm2 delete dex-api

# Monitorar recursos
pm2 monit

# Salvar configuração atual
pm2 save

# Configurar auto-start no boot
pm2 startup
# Executar o comando que ele mostrar
```

---

## 📞 Checklist Antes de Pedir Ajuda

Antes de solicitar suporte, verifique:

- [ ] Executei `bash DIAGNOSE_SERVER.sh`
- [ ] Executei `bash QUICK_FIX.sh`
- [ ] Li o arquivo `diagnostic_*.log` gerado
- [ ] Verifiquei logs do PM2: `pm2 logs dex-api --lines 100`
- [ ] Verifiquei logs do Nginx: `sudo tail -n 100 /var/log/nginx/error.log`
- [ ] Testei health check local: `curl http://localhost:3000/api/ifood-auth/health`
- [ ] Testei health check externo: `curl https://api.usa-dex.com.br/api/ifood-auth/health`
- [ ] Verifiquei se .env existe e está configurado
- [ ] Verifiquei se node_modules existe

---

## 🔗 Links Úteis

- **Guia de Troubleshooting Completo**: `TROUBLESHOOTING_GUIDE.md`
- **Documentação da API**: `README.md`
- **Guia de Deploy**: `DEPLOY.md`
- **Validação de Auth**: `IFOOD_AUTH_VALIDATION.md`

---

## 💡 Dicas

1. **Sempre verifique os logs primeiro**
   ```bash
   pm2 logs dex-api --lines 100
   ```

2. **Use o health check para diagnóstico rápido**
   ```bash
   curl http://localhost:3000/api/ifood-auth/health | jq
   ```

3. **Mantenha backups do .env**
   ```bash
   cp .env .env.backup
   ```

4. **Monitore recursos regularmente**
   ```bash
   pm2 monit
   ```

5. **Configure alertas no Discord**
   - Adicione `DISCORD_WEBHOOK_URL` no .env
   - Você receberá notificações automáticas de erros

---

**Última atualização**: 2025-01-07
