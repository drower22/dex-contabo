# 🔷 Deploy TypeScript no Contabo

## Arquitetura

O servidor roda **100% TypeScript** usando `ts-node` para executar os arquivos `.ts` diretamente em produção.

```
dex-contabo/
├── api/
│   ├── server.ts          ← Servidor Express TypeScript
│   └── ifood-auth/
│       ├── health.ts      ← Handlers TypeScript
│       ├── link.ts
│       ├── exchange.ts
│       ├── refresh.ts
│       └── status.ts
├── ecosystem.config.js    ← PM2 config com ts-node
├── tsconfig.json
└── package.json
```

## Pré-requisitos no Servidor

```bash
# 1. Node.js 18+ instalado
node --version  # deve ser >= 18

# 2. PM2 instalado globalmente
npm install -g pm2

# 3. Git configurado
git --version
```

## Deploy Passo a Passo

### 1. Clonar/Atualizar Repositório

```bash
# SSH no servidor Contabo
ssh root@api.usa-dex.com.br

# Navegar para o diretório
cd /var/www/dex-backend

# Atualizar código
git pull origin main
```

### 2. Instalar Dependências

```bash
cd dex-contabo

# Instalar dependências (incluindo ts-node)
npm install

# Verificar se ts-node foi instalado
npx ts-node --version
```

### 3. Configurar Variáveis de Ambiente

```bash
# Criar/editar .env
nano .env

# Adicionar variáveis obrigatórias:
SUPABASE_URL=https://seibcrrxlyxfqudrrage.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua_service_role_key>
ENCRYPTION_KEY=<sua_encryption_key_base64>
IFOOD_CLIENT_ID_REVIEWS=<client_id_reviews>
IFOOD_CLIENT_SECRET_REVIEWS=<client_secret_reviews>
IFOOD_CLIENT_ID_FINANCIAL=<client_id_financial>
IFOOD_CLIENT_SECRET_FINANCIAL=<client_secret_financial>
CORS_ORIGIN=https://dex-parceiros-api-ifood-nxij.vercel.app
NODE_ENV=production
PORT=3000
```

### 4. Testar Localmente (Opcional)

```bash
# Rodar servidor TypeScript
npm start

# Em outro terminal, testar
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/ifood-auth/link?scope=financial \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"test"}'

# Se funcionar, parar com Ctrl+C
```

### 5. Deploy com PM2

```bash
# Parar instância anterior (se existir)
pm2 stop dex-api
pm2 delete dex-api

# Iniciar com TypeScript
npm run pm2:start

# Verificar status
pm2 status

# Ver logs
pm2 logs dex-api --lines 50

# Salvar configuração PM2
pm2 save

# Configurar PM2 para iniciar no boot
pm2 startup
# Copiar e executar o comando que aparecer
```

### 6. Configurar Nginx (se necessário)

```bash
# Editar configuração Nginx
sudo nano /etc/nginx/sites-available/api.usa-dex.com.br

# Garantir que proxy_pass aponta para porta 3000
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}

# Testar configuração
sudo nginx -t

# Recarregar Nginx
sudo systemctl reload nginx
```

### 7. Validar Deploy

```bash
# Testar health check
curl https://api.usa-dex.com.br/api/health

# Deve retornar:
# {
#   "status": "healthy",
#   "timestamp": "...",
#   "env": "production",
#   "typescript": true
# }

# Testar endpoint de link
curl -X POST https://api.usa-dex.com.br/api/ifood-auth/link?scope=financial \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"111"}'

# Deve retornar userCode ou erro claro (não mais 501)
```

## Comandos Úteis

### Gerenciar Servidor

```bash
# Ver status
pm2 status

# Ver logs em tempo real
pm2 logs dex-api

# Reiniciar após mudanças
pm2 restart dex-api

# Parar servidor
pm2 stop dex-api

# Ver métricas
pm2 monit
```

### Atualizar Código

```bash
# 1. Pull do repositório
cd /var/www/dex-backend/dex-contabo
git pull origin main

# 2. Instalar novas dependências (se houver)
npm install

# 3. Reiniciar PM2
pm2 restart dex-api

# 4. Verificar logs
pm2 logs dex-api --lines 20
```

### Debug

```bash
# Ver logs de erro
pm2 logs dex-api --err

# Ver logs completos
pm2 logs dex-api --lines 100

# Verificar se ts-node está funcionando
pm2 describe dex-api | grep interpreter

# Testar TypeScript manualmente
npx ts-node api/server.ts
```

## Troubleshooting

### Erro: "Cannot find module 'ts-node'"

```bash
# Instalar ts-node
npm install ts-node

# Ou globalmente
npm install -g ts-node
```

### Erro: "Cannot find module 'cors'"

```bash
# Instalar dependências
npm install

# Verificar se node_modules existe
ls -la node_modules/
```

### Erro: TypeScript compilation errors

```bash
# Verificar erros de tipo
npm run type-check

# Ver tsconfig.json
cat tsconfig.json

# Forçar recompilação
rm -rf node_modules/.cache
npm install
```

### PM2 não inicia

```bash
# Ver logs detalhados
pm2 logs dex-api --err --lines 50

# Verificar ecosystem.config.js
cat ecosystem.config.js

# Tentar rodar manualmente
npm start

# Se funcionar manualmente, problema é no PM2
pm2 delete dex-api
pm2 start ecosystem.config.js
```

### Porta 3000 já em uso

```bash
# Ver processo usando porta 3000
sudo lsof -i :3000

# Matar processo
sudo kill -9 <PID>

# Ou mudar porta no .env
echo "PORT=3001" >> .env
pm2 restart dex-api
```

## Vantagens do TypeScript em Produção

✅ **Type Safety**: Erros detectados em tempo de desenvolvimento  
✅ **Manutenibilidade**: Código mais fácil de entender e refatorar  
✅ **IntelliSense**: Autocompletar e documentação inline  
✅ **Refactoring**: Mudanças seguras com detecção automática de erros  
✅ **Sem Build Step**: ts-node executa diretamente, simplifica deploy  

## Performance

O `ts-node` adiciona overhead mínimo (~5-10ms por request). Para otimizar:

1. **Usar cache**: ts-node cacheia compilações
2. **Modo cluster**: PM2 roda múltiplas instâncias
3. **Compilar para JS** (opcional): Para máxima performance

### Compilar para JavaScript (Opcional)

Se precisar de máxima performance:

```bash
# Compilar TypeScript para JavaScript
npx tsc

# Arquivos JS gerados em ./dist/
ls dist/

# Atualizar ecosystem.config.js
# script: './dist/api/server.js'
# Remover interpreter_args

# Reiniciar
pm2 restart dex-api
```

## Checklist de Deploy

- [ ] Código atualizado (`git pull`)
- [ ] Dependências instaladas (`npm install`)
- [ ] Variáveis de ambiente configuradas (`.env`)
- [ ] ts-node instalado e funcionando
- [ ] PM2 iniciado (`pm2 start`)
- [ ] Logs sem erros (`pm2 logs`)
- [ ] Health check retorna 200
- [ ] Endpoints funcionando (não retornam 501)
- [ ] Nginx configurado e recarregado
- [ ] PM2 salvo (`pm2 save`)
- [ ] PM2 startup configurado

---

**Última atualização**: 2025-11-04  
**Autor**: Cascade AI Assistant  
**Versão**: TypeScript 100%
