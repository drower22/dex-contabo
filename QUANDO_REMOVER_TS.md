# 🗑️ Quando Remover Arquivos TypeScript?

## ⚠️ IMPORTANTE: Não Apague Ainda!

**Recomendação: Mantenha os arquivos .ts por 1 semana após a migração.**

## 📋 Checklist Antes de Remover

Só remova os arquivos TypeScript depois de:

- [ ] ✅ Migração para JS executada no servidor
- [ ] ✅ API funcionando 100% em produção
- [ ] ✅ Health check retornando `healthy`
- [ ] ✅ Todos os endpoints testados e funcionando
- [ ] ✅ Sem erros nos logs por 24 horas
- [ ] ✅ Performance estável
- [ ] ✅ Memória estável (< 80% heap)
- [ ] ✅ Backup dos arquivos TS criado

## 🎯 Estratégia Recomendada

### Fase 1: Deploy Paralelo (Agora)
```bash
# Manter ambos os arquivos no repositório
api/
├── server.ts          # ← Manter (backup)
├── server-node.js     # ← Novo (em uso)
├── _shared/
│   ├── crypto.ts      # ← Manter (backup)
│   └── crypto.js      # ← Novo (em uso)
└── ifood-auth/
    ├── health.ts      # ← Manter (backup)
    └── health.js      # ← Novo (em uso)
```

**Vantagens:**
- ✅ Rollback rápido se necessário
- ✅ Referência para comparação
- ✅ Segurança

### Fase 2: Período de Teste (1 semana)
- Monitorar logs diariamente
- Verificar performance
- Testar todos os endpoints
- Coletar feedback

### Fase 3: Remoção (Após 1 semana estável)
```bash
# Depois de 1 semana sem problemas
cd /home/ismar/Área\ de\ trabalho/dex-frontend-main\ \(APi\ iFood\)/dex-contabo

# Remover arquivos TS
git rm api/server.ts
git rm api/_shared/crypto.ts
git rm api/_shared/discord.ts
git rm api/_shared/logger.ts
git rm api/_shared/retry.ts
git rm api/ifood-auth/*.ts
git rm api/cron/*.ts
git rm api/ifood/**/*.ts

# Commit
git commit -m "chore: Remove arquivos TypeScript após migração bem-sucedida"
git push origin main
```

## 🔄 Arquivos a Remover (Eventualmente)

### Código TypeScript
```
api/server.ts
api/_shared/crypto.ts
api/_shared/discord.ts
api/_shared/logger.ts
api/_shared/retry.ts
api/ifood-auth/health.ts
api/ifood-auth/link.ts
api/ifood-auth/exchange.ts
api/ifood-auth/refresh.ts
api/ifood-auth/status.ts
api/cron/health-check.ts
api/cron/refresh-tokens.ts
api/ifood/**/*.ts
```

### Configuração TypeScript
```
tsconfig.json
```

### Dependências TypeScript (package.json)
```json
{
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.2"
  }
}
```

## ⚡ Remoção Rápida (Após Validação)

Se tudo estiver funcionando perfeitamente após 1 semana:

```bash
cd /home/ismar/Área\ de\ trabalho/dex-frontend-main\ \(APi\ iFood\)/dex-contabo

# Script de remoção rápida
cat > remove-ts.sh << 'EOF'
#!/bin/bash
echo "🗑️  Removendo arquivos TypeScript..."

# Remover arquivos .ts
find api -name "*.ts" -type f -exec git rm {} \;

# Remover tsconfig.json
git rm tsconfig.json

# Commit
git commit -m "chore: Remove arquivos TypeScript após migração bem-sucedida para JavaScript

A API está rodando estável em JavaScript puro há 1 semana.
Todos os testes passaram e a performance melhorou significativamente."

echo "✅ Arquivos TypeScript removidos"
echo "Execute: git push origin main"
EOF

chmod +x remove-ts.sh
bash remove-ts.sh
```

## 🚨 Sinais de Que Ainda NÃO Deve Remover

- ❌ Erros intermitentes nos logs
- ❌ Performance instável
- ❌ Memória crescendo continuamente
- ❌ Endpoints falhando ocasionalmente
- ❌ Menos de 1 semana em produção
- ❌ Não testou todos os endpoints

## ✅ Sinais de Que PODE Remover

- ✅ 1+ semana sem erros
- ✅ Performance estável e melhor que antes
- ✅ Memória estável (< 80% heap)
- ✅ Todos os endpoints testados
- ✅ Health check sempre `healthy`
- ✅ Logs limpos (sem erros)
- ✅ Equipe confiante na migração

## 📊 Métricas para Validar

Antes de remover, confirme:

```bash
# No servidor
cd /home/dex/dex-app

# 1. Uptime > 7 dias
pm2 describe dex-api | grep uptime

# 2. Sem restarts
pm2 describe dex-api | grep restarts

# 3. Memória estável
pm2 describe dex-api | grep memory

# 4. Sem erros nos logs
pm2 logs dex-api --err --lines 1000 | grep -i error | wc -l
# Deve retornar 0 ou muito próximo

# 5. Health check sempre OK
for i in {1..10}; do
  curl -s http://localhost:3000/api/ifood-auth/health | jq -r .status
  sleep 1
done
# Deve retornar "healthy" 10 vezes
```

## 🎯 Recomendação Final

### Para o SEU caso:

**AGORA (Hoje):**
1. ✅ Fazer commit com AMBOS os arquivos (.ts e .js)
2. ✅ Push para GitHub
3. ✅ Deploy no servidor
4. ✅ Testar tudo

**SEMANA QUE VEM:**
1. ⏳ Monitorar diariamente
2. ⏳ Validar métricas
3. ⏳ Testar endpoints

**DAQUI A 1 SEMANA:**
1. 🗑️ Remover arquivos .ts
2. 🗑️ Remover dependências TypeScript
3. 🗑️ Push final

---

## 💡 Dica Pro

Crie uma tag antes de remover os arquivos TS:

```bash
# Criar tag de backup
git tag -a v1.0.0-ts-backup -m "Backup antes de remover TypeScript"
git push origin v1.0.0-ts-backup

# Agora pode remover com segurança
# Se precisar voltar: git checkout v1.0.0-ts-backup
```

---

**Última atualização**: 2025-11-07
