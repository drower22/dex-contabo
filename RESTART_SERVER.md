# 🚀 Como Reiniciar o Servidor Corretamente no Contabo

## Problema Atual
O servidor foi deletado do PM2 e precisa ser reiniciado com TypeScript habilitado.

## Solução: Usar o ecosystem.config.js

```bash
# 1. Conectar ao servidor
ssh root@89.116.29.187

# 2. Ir para o diretório correto
cd /var/www/dex-contabo

# 3. Verificar que ts-node está instalado
npm list ts-node

# Se não estiver instalado:
npm install

# 4. Iniciar usando o ecosystem config (RECOMENDADO)
pm2 start ecosystem.config.js

# 5. Salvar configuração do PM2
pm2 save

# 6. Configurar PM2 para iniciar no boot
pm2 startup

# 7. Ver logs
pm2 logs dex-api --lines 50

# 8. Testar
curl -I -H "Origin: http://localhost:5173" https://api.usa-dex.com.br/api/health
```

## Validação

Os logs devem mostrar:
```
🚀 Dex Contabo API (TypeScript) running on http://localhost:3000
📝 Environment: production
🔗 CORS Origin: *
✅ Health check: http://localhost:3000/api/health
🔷 TypeScript: Enabled via ts-node
```

## Se der erro de ts-node

```bash
# Instalar globalmente
npm install -g ts-node typescript

# Ou usar apenas node (se os arquivos .js existirem)
pm2 start api/server.js --name dex-api
```

## Comandos Úteis

```bash
# Ver status
pm2 list

# Ver logs em tempo real
pm2 logs dex-api

# Reiniciar
pm2 restart dex-api

# Parar
pm2 stop dex-api

# Ver informações detalhadas
pm2 info dex-api

# Monitorar recursos
pm2 monit
```

## Troubleshooting

### Erro: "ts-node not found"
```bash
cd /var/www/dex-contabo
npm install
pm2 restart dex-api
```

### Erro: "Module not found"
```bash
cd /var/www/dex-contabo
npm install
pm2 restart dex-api
```

### Erro: "Port 3000 already in use"
```bash
# Ver o que está usando a porta
sudo lsof -i :3000

# Matar o processo
sudo kill -9 <PID>

# Reiniciar
pm2 restart dex-api
```

### Servidor não responde
```bash
# Ver logs de erro
pm2 logs dex-api --err --lines 100

# Verificar se o Nginx está rodando
sudo systemctl status nginx

# Reiniciar Nginx se necessário
sudo systemctl restart nginx
```
