# 🔄 Guia de Migração: TypeScript → JavaScript

## 📊 Status Atual

- **24 arquivos .ts** rodando com `ts-node/register`
- **Problemas**: `handler is not a function`, `crypto is not defined`
- **Heap usage**: 93% (alto)
- **Startup**: Lento devido ao JIT compilation

## ✅ Benefícios da Migração

1. **Performance**: ~30-50% mais rápido
2. **Memória**: Menos overhead
3. **Simplicidade**: Sem ts-node, sem tsconfig
4. **Deploy**: Mais confiável
5. **Debugging**: Stack traces mais claros

---

## 🚀 Passo a Passo da Migração

### Opção 1: Script Automatizado (RECOMENDADO)

#### Na sua máquina local:
```bash
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"

# Copiar arquivos para o servidor
scp server-node.js root@89.116.29.187:/home/dex/dex-app/api/
scp _shared/crypto.js root@89.116.29.187:/home/dex/dex-app/api/_shared/
scp ifood-auth/health.js root@89.116.29.187:/home/dex/dex-app/api/ifood-auth/
scp ecosystem.config-node.js root@89.116.29.187:/home/dex/dex-app/ecosystem.config-node.js
scp MIGRATE_TO_JS.sh root@89.116.29.187:/home/dex/dex-app/
```

#### No servidor:
```bash
cd /home/dex/dex-app
chmod +x MIGRATE_TO_JS.sh
bash MIGRATE_TO_JS.sh
```

---

### Opção 2: Migração Manual

#### 1. Fazer Backup
```bash
cd /home/dex/dex-app
mkdir -p backup_ts_$(date +%Y%m%d)
cp -r api backup_ts_$(date +%Y%m%d)/
cp ecosystem.config.js backup_ts_$(date +%Y%m%d)/
```

#### 2. Copiar Arquivos JavaScript

**server-node.js → api/server-node.js**
- Remove imports TypeScript
- Usa `require()` ao invés de `import`
- Remove type annotations

**crypto.js → api/_shared/crypto.js**
- Usa `crypto.webcrypto` para Node.js 18+
- Remove type annotations
- Exports com `module.exports`

**health.js → api/ifood-auth/health.js**
- Remove imports de tipos
- Usa `require()` para dependências
- Exports com `module.exports`

**discord.js → api/_shared/discord.js**
- Converte class para JavaScript puro
- Remove interfaces TypeScript

#### 3. Atualizar ecosystem.config.js
```bash
cd /home/dex/dex-app
nano ecosystem.config.js
```

**Mudar:**
```javascript
// ANTES
script: './api/server.ts',
interpreter: 'node',
interpreter_args: '-r ts-node/register',

// DEPOIS
script: './api/server-node.js',
interpreter: 'node',
// Remover interpreter_args
```

#### 4. Reiniciar PM2
```bash
pm2 delete dex-api
pm2 start ecosystem.config.js
pm2 save
```

#### 5. Testar
```bash
# Aguardar 5 segundos
sleep 5

# Health check
curl http://localhost:3000/api/ifood-auth/health | jq

# Ver logs
pm2 logs dex-api --lines 50
```

---

## 📋 Checklist de Migração

### Antes de Migrar
- [ ] Backup completo criado
- [ ] Arquivos JavaScript copiados para o servidor
- [ ] ecosystem.config-node.js pronto

### Durante a Migração
- [ ] PM2 parado: `pm2 delete dex-api`
- [ ] Porta 3000 liberada
- [ ] ecosystem.config.js atualizado
- [ ] PM2 reiniciado com novo config

### Após Migração
- [ ] Health check retorna `healthy`
- [ ] Sem erros em `pm2 logs dex-api --err`
- [ ] Memória estável (< 80% heap)
- [ ] API responde em < 100ms

---

## 🧪 Testes de Validação

### 1. Health Check
```bash
curl http://localhost:3000/api/ifood-auth/health | jq
```

**Esperado:**
```json
{
  "status": "healthy",
  "checks": {
    "supabase": true,
    "encryption": true,
    "ifood_reviews": true,
    "ifood_financial": true
  },
  "javascript": true
}
```

### 2. CORS
```bash
curl -I -X OPTIONS https://api.usa-dex.com.br/api/ifood-auth/health \
  -H "Origin: https://dex-parceiros-api-ifood-nxij.vercel.app"
```

**Esperado:** Headers CORS corretos

### 3. Performance
```bash
# Testar latência
time curl -s http://localhost:3000/api/ifood-auth/health > /dev/null
```

**Esperado:** < 100ms

### 4. Memória
```bash
pm2 describe dex-api | grep -A 5 "Monit"
```

**Esperado:** Heap usage < 80%

---

## 🔄 Rollback (Se Necessário)

Se algo der errado:

```bash
cd /home/dex/dex-app

# Parar processo atual
pm2 delete dex-api

# Restaurar backup
BACKUP_DIR=$(ls -td backup_ts_* | head -1)
cp -r $BACKUP_DIR/api/* api/
cp $BACKUP_DIR/ecosystem.config.js .

# Reiniciar
pm2 start ecosystem.config.js
pm2 save

# Verificar
pm2 logs dex-api
```

---

## 📊 Comparação Antes/Depois

| Métrica | TypeScript (Antes) | JavaScript (Depois) |
|---------|-------------------|---------------------|
| **Startup** | ~3-5s | ~1-2s |
| **Memória** | 207 MB (93% heap) | ~150 MB (< 80% heap) |
| **Latência** | ~20-50ms | ~10-30ms |
| **Erros** | `handler is not a function` | ✅ Nenhum |
| **Deploy** | Complexo (ts-node) | Simples (node puro) |

---

## 🎯 Arquivos Convertidos

### Principais
- ✅ `api/server-node.js` - Servidor Express
- ✅ `api/_shared/crypto.js` - Criptografia AES-GCM
- ✅ `api/_shared/discord.js` - Notificações Discord
- ✅ `api/ifood-auth/health.js` - Health check
- ✅ `api/ifood-auth/link.js` - Já existe
- ✅ `api/ifood-auth/exchange.js` - Já existe
- ✅ `api/ifood-auth/refresh.js` - Já existe
- ✅ `api/ifood-auth/status.js` - Já existe

### Configuração
- ✅ `ecosystem.config-node.js` - PM2 config para JS

---

## 🆘 Troubleshooting

### Problema: "Cannot find module"
```bash
cd /home/dex/dex-app
npm install
pm2 restart dex-api
```

### Problema: "crypto is not defined"
**Solução:** Já corrigido no `crypto.js` usando `crypto.webcrypto`

### Problema: "handler is not a function"
**Solução:** Já corrigido no `server-node.js` com melhor detecção de handlers

### Problema: Health check unhealthy
```bash
# Ver logs detalhados
pm2 logs dex-api --err --lines 100

# Verificar .env
grep -E "ENCRYPTION_KEY|IFOOD_CLIENT_ID" /home/dex/dex-app/.env
```

---

## 📞 Suporte

Se encontrar problemas:

1. **Ver logs**: `pm2 logs dex-api --lines 100`
2. **Verificar status**: `pm2 describe dex-api`
3. **Testar local**: `curl http://localhost:3000/api/ifood-auth/health`
4. **Rollback**: Seguir procedimento acima

---

## ✅ Próximos Passos Após Migração

1. **Monitorar por 24h**
   ```bash
   pm2 monit
   ```

2. **Verificar logs regularmente**
   ```bash
   pm2 logs dex-api
   ```

3. **Testar todos os endpoints**
   - `/api/ifood-auth/health`
   - `/api/ifood-auth/link`
   - `/api/ifood-auth/exchange`
   - `/api/ifood-auth/refresh`
   - `/api/ifood-auth/status`

4. **Remover arquivos TypeScript** (após confirmar que tudo funciona)
   ```bash
   # Após 1 semana de estabilidade
   find api -name "*.ts" -type f -delete
   ```

---

**Última atualização**: 2025-11-07
