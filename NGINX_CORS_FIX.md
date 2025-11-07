# 🔧 Correção DEFINITIVA do CORS no Nginx

## Problema Identificado

O Nginx está **sobrescrevendo** o header CORS que o Express envia, forçando:
```
access-control-allow-origin: https://dex-parceiros-api-ifood-nxij.vercel.app
```

Mesmo com `CORS_ORIGIN="*"` no `.env`, o Nginx ignora e força o domínio do Vercel.

## Solução: Remover CORS do Nginx

Execute estes comandos no servidor Contabo:

```bash
# 1. Conectar ao servidor
ssh root@api.usa-dex.com.br

# 2. Backup da configuração atual
sudo cp /etc/nginx/sites-available/api.usa-dex.com.br /etc/nginx/sites-available/api.usa-dex.com.br.backup.$(date +%Y%m%d_%H%M%S)

# 3. Ver configuração atual
sudo cat /etc/nginx/sites-available/api.usa-dex.com.br

# 4. Editar e REMOVER linhas de CORS
sudo nano /etc/nginx/sites-available/api.usa-dex.com.br
```

## O que REMOVER do arquivo Nginx

Procure e **DELETE** estas linhas (se existirem):

```nginx
add_header Access-Control-Allow-Origin https://dex-parceiros-api-ifood-nxij.vercel.app;
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Credentials true;
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
add_header Access-Control-Allow-Headers "Content-Type, Authorization";
```

## Como deve ficar (apenas proxy, SEM add_header CORS)

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.usa-dex.com.br;

    # Redirecionar HTTP para HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.usa-dex.com.br;

    # Certificados SSL
    ssl_certificate /etc/letsencrypt/live/api.usa-dex.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.usa-dex.com.br/privkey.pem;

    # Proxy para o Express (porta 3000)
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # NÃO adicione add_header CORS aqui!
        # O Express já cuida disso via middleware cors()
    }

    # Outras configurações...
}
```

## Passos após editar

```bash
# 5. Testar configuração do Nginx
sudo nginx -t

# 6. Se OK, recarregar Nginx
sudo systemctl reload nginx

# 7. Verificar que o PM2 está rodando
pm2 list

# 8. Se necessário, reiniciar o app
pm2 restart dex-api

# 9. Ver logs do app
pm2 logs dex-api --lines 20
```

## Validação

```bash
# Testar CORS do localhost
curl -I -H "Origin: http://localhost:5173" https://api.usa-dex.com.br/api/health

# Deve retornar:
# access-control-allow-origin: *
# OU
# access-control-allow-origin: http://localhost:5173
```

**NÃO deve mais retornar:**
```
access-control-allow-origin: https://dex-parceiros-api-ifood-nxij.vercel.app
```

## Se o Nginx não tiver configuração de CORS

Se ao abrir o arquivo você **não encontrar** nenhuma linha `add_header Access-Control-Allow-Origin`, então o problema pode ser:

1. **Outro arquivo de configuração**
   ```bash
   sudo grep -r "Access-Control-Allow-Origin" /etc/nginx/
   ```

2. **Configuração global do Nginx**
   ```bash
   sudo cat /etc/nginx/nginx.conf | grep -A5 -B5 "Access-Control"
   ```

3. **O Express não está sendo usado**
   - Verifique se o PM2 está rodando:
     ```bash
     pm2 list
     pm2 logs dex-api --lines 50
     ```
   - Deve aparecer: `🔗 CORS Origin: *`

## Rollback (se algo der errado)

```bash
# Restaurar backup
sudo cp /etc/nginx/sites-available/api.usa-dex.com.br.backup.YYYYMMDD_HHMMSS /etc/nginx/sites-available/api.usa-dex.com.br
sudo nginx -t
sudo systemctl reload nginx
```

## Após a correção

1. Recarregue o frontend (Ctrl+Shift+R)
2. Abra o console do navegador
3. Vá para Settings
4. Os requests para `/api/ifood-auth/status` devem funcionar sem erro CORS
5. Os badges de status devem carregar corretamente

---

**Execute os comandos acima no servidor e me avise o resultado do `curl` final.**
