# 🚀 Processo de Deploy Seguro

## 📊 Fluxo Completo

```
Sua Máquina Local
       ↓
   Git Push
       ↓
    GitHub
       ↓
GitHub Actions (Workflow)
       ↓
    Contabo Server
       ↓
   PM2 Restart
       ↓
  Health Check
       ↓
✅ Deploy OK ou ❌ Rollback
```

## 🎯 Passo a Passo

### 1. Na Sua Máquina (AGORA)

```bash
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"

# Dar permissão
chmod +x DEPLOY_SEGURO.sh

# Executar
bash DEPLOY_SEGURO.sh
```

**O script vai perguntar:**
1. ❓ Manter ou remover arquivos .ts?
   - **Responda: 1** (manter como backup)
2. ❓ Confirmar commit?
   - **Responda: y**
3. ❓ Fazer push?
   - **Responda: y**

### 2. GitHub Actions (AUTOMÁTICO)

Assim que você fizer push, o workflow inicia:

```yaml
✅ Step 1: SSH ping (testa conexão)
✅ Step 2: Deploy remoto
   ├─ Backup automático
   ├─ Git pull
   ├─ npm install
   ├─ Detecta migração JS
   ├─ Atualiza ecosystem.config.js
   ├─ PM2 restart
   ├─ Aguarda 5s
   ├─ Testa health check
   └─ ✅ Sucesso ou ❌ Rollback
```

**Tempo estimado: 2-3 minutos**

### 3. Acompanhar Deploy

**Opção A: GitHub Actions (Web)**
```
https://github.com/drower22/dex-contabo/actions
```

**Opção B: Logs no Servidor (SSH)**
```bash
ssh root@89.116.29.187
pm2 logs dex-api --lines 100
```

### 4. Validar Deploy

```bash
# Testar health check
curl https://api.usa-dex.com.br/api/ifood-auth/health | jq

# Deve retornar:
{
  "status": "healthy",
  "checks": {
    "supabase": true,
    "encryption": true,
    "ifood_reviews": true,
    "ifood_financial": true
  }
}
```

---

## 🛡️ Segurança do Deploy

### Backup Automático
Antes de cada deploy, o workflow cria:
```
/home/dex/dex-app/backup_pre_deploy_YYYYMMDD_HHMMSS/
├── api/
└── ecosystem.config.js
```

### Health Check Automático
Após reiniciar PM2, testa:
```bash
curl http://localhost:3000/api/ifood-auth/health
```

### Rollback Automático
Se health check falhar:
1. ❌ Detecta falha
2. 🔄 Para PM2
3. 📦 Restaura backup
4. ✅ Reinicia versão anterior
5. 🚨 Workflow falha (você recebe notificação)

---

## 📋 Checklist de Deploy

### Antes do Deploy
- [ ] Arquivos JavaScript criados localmente
- [ ] Workflow atualizado (`.github/workflows/deploy.yml`)
- [ ] Script de deploy pronto (`DEPLOY_SEGURO.sh`)

### Durante o Deploy
- [ ] Push para main executado
- [ ] Workflow iniciado no GitHub Actions
- [ ] Acompanhando logs

### Após o Deploy
- [ ] Health check retorna `healthy`
- [ ] API responde normalmente
- [ ] Sem erros nos logs: `pm2 logs dex-api --err`
- [ ] Performance estável

---

## 🔍 Monitoramento Pós-Deploy

### Primeiras 24 horas

```bash
# No servidor
ssh root@89.116.29.187

# 1. Ver status PM2
pm2 list

# 2. Monitorar logs em tempo real
pm2 logs dex-api

# 3. Ver apenas erros
pm2 logs dex-api --err

# 4. Verificar memória
pm2 describe dex-api | grep -A 5 "Monit"

# 5. Testar endpoints
curl http://localhost:3000/api/ifood-auth/health
curl http://localhost:3000/api/ifood-auth/status
```

### Métricas Esperadas

| Métrica | Antes (TS) | Depois (JS) | Status |
|---------|------------|-------------|--------|
| Startup | 3-5s | 1-2s | ✅ Melhor |
| Memória | 207 MB (93%) | ~150 MB (<80%) | ✅ Melhor |
| Latência | 20-50ms | 10-30ms | ✅ Melhor |
| Erros | handler is not a function | Nenhum | ✅ Resolvido |

---

## 🆘 Se Algo Der Errado

### Cenário 1: Workflow Falha

O rollback é **automático**. Você não precisa fazer nada.

**Verificar:**
```bash
ssh root@89.116.29.187
pm2 logs dex-api --lines 100
```

### Cenário 2: Deploy OK mas API Instável

```bash
# No servidor
ssh root@89.116.29.187
cd /home/dex/dex-app

# Ver backups disponíveis
ls -lt backup_pre_deploy_*

# Rollback manual
BACKUP_DIR=$(ls -td backup_pre_deploy_* | head -1)
pm2 delete dex-api
cp -r "$BACKUP_DIR/api/"* api/
cp "$BACKUP_DIR/ecosystem.config.js" .
pm2 start ecosystem.config.js
pm2 save
```

### Cenário 3: Precisa Reverter no Git

```bash
# Na sua máquina
cd "/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"

# Ver commits recentes
git log --oneline -5

# Reverter último commit
git revert HEAD
git push origin main

# Isso vai disparar novo deploy com versão anterior
```

---

## 📊 Timeline Esperada

```
T+0min:  Push para GitHub
T+1min:  Workflow inicia
T+2min:  Deploy no servidor
T+3min:  Health check OK
T+5min:  Validação manual
T+1h:    Monitoramento inicial
T+24h:   Primeira validação completa
T+7d:    Remover arquivos .ts (se estável)
```

---

## ✅ Sucesso do Deploy

Você saberá que deu certo quando:

1. ✅ Workflow do GitHub mostra ✅ verde
2. ✅ Health check retorna `healthy`
3. ✅ `pm2 list` mostra processo `online`
4. ✅ Sem erros em `pm2 logs dex-api --err`
5. ✅ API responde em < 100ms
6. ✅ Memória < 80% heap

---

## 🎯 Próximos Passos Após Deploy

### Imediato (Hoje)
- [ ] Validar health check
- [ ] Testar endpoints principais
- [ ] Verificar logs

### Curto Prazo (Esta Semana)
- [ ] Monitorar diariamente
- [ ] Validar performance
- [ ] Coletar métricas

### Médio Prazo (Próxima Semana)
- [ ] Remover arquivos .ts (se estável)
- [ ] Limpar dependências TypeScript
- [ ] Documentar lições aprendidas

---

**Última atualização**: 2025-11-07
