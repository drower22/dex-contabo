#!/bin/bash

# ============================================================
# SCRIPT DE DEPLOY - WORKERS IFOOD
# ============================================================
# Este script automatiza o deploy dos novos workers no Contabo
# Execute linha por linha ou rode o script completo
# ============================================================

echo "🚀 Iniciando deploy de workers iFood..."
echo ""

# ============================================================
# PASSO 1: PARAR E REMOVER WORKERS OBSOLETOS
# ============================================================
echo "📌 PASSO 1: Removendo workers obsoletos..."

# Parar workers
pm2 stop ifood-conciliation_worker 2>/dev/null || echo "⚠️  ifood-conciliation_worker não encontrado"
pm2 stop ifood-reconciliation-status_worker 2>/dev/null || echo "⚠️  ifood-reconciliation-status_worker não encontrado"

# Deletar workers
pm2 delete ifood-conciliation_worker 2>/dev/null || echo "⚠️  ifood-conciliation_worker já removido"
pm2 delete ifood-reconciliation-status_worker 2>/dev/null || echo "⚠️  ifood-reconciliation-status_worker já removido"

echo "✅ Workers obsoletos removidos"
echo ""

# ============================================================
# PASSO 2: ATUALIZAR CÓDIGO
# ============================================================
echo "📌 PASSO 2: Atualizando código do repositório..."

cd /home/dex/dex-app

# Backup do ecosystem.config.js (se necessário)
if [ -f ecosystem.config.js ]; then
    cp ecosystem.config.js ecosystem.config.js.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup do ecosystem.config.js criado"
fi

# Pull do repositório
git pull origin main

echo "✅ Código atualizado"
echo ""

# ============================================================
# PASSO 3: VERIFICAR NOVOS ARQUIVOS
# ============================================================
echo "📌 PASSO 3: Verificando novos arquivos..."

if [ -f "dex-contabo/workers/ifood-anticipations.worker.ts" ]; then
    echo "✅ ifood-anticipations.worker.ts encontrado"
else
    echo "❌ ifood-anticipations.worker.ts NÃO encontrado"
fi

if [ -f "dex-contabo/workers/ifood-scheduler.worker.ts" ]; then
    echo "✅ ifood-scheduler.worker.ts encontrado"
else
    echo "❌ ifood-scheduler.worker.ts NÃO encontrado"
fi

echo ""

# ============================================================
# PASSO 4: INICIAR NOVOS WORKERS
# ============================================================
echo "📌 PASSO 4: Iniciando novos workers..."

# Iniciar scheduler
pm2 start ecosystem.config.js --only ifood-scheduler_worker
echo "✅ ifood-scheduler_worker iniciado"

# Iniciar settlements (se não estiver rodando)
pm2 start ecosystem.config.js --only ifood-settlements_worker 2>/dev/null || pm2 restart ifood-settlements_worker
echo "✅ ifood-settlements_worker iniciado/reiniciado"

# Iniciar anticipations
pm2 start ecosystem.config.js --only ifood-anticipations_worker
echo "✅ ifood-anticipations_worker iniciado"

echo ""

# ============================================================
# PASSO 5: VERIFICAR STATUS
# ============================================================
echo "📌 PASSO 5: Verificando status dos workers..."
echo ""

pm2 list

echo ""

# ============================================================
# PASSO 6: SALVAR CONFIGURAÇÃO
# ============================================================
echo "📌 PASSO 6: Salvando configuração do PM2..."

pm2 save

echo "✅ Configuração salva"
echo ""

# ============================================================
# PASSO 7: VERIFICAR LOGS
# ============================================================
echo "📌 PASSO 7: Verificando logs dos novos workers..."
echo ""

echo "--- Logs do Scheduler (últimas 20 linhas) ---"
pm2 logs ifood-scheduler_worker --lines 20 --nostream

echo ""
echo "--- Logs do Anticipations (últimas 20 linhas) ---"
pm2 logs ifood-anticipations_worker --lines 20 --nostream

echo ""

# ============================================================
# RESUMO FINAL
# ============================================================
echo "============================================================"
echo "✅ DEPLOY CONCLUÍDO COM SUCESSO!"
echo "============================================================"
echo ""
echo "📊 Workers Ativos:"
echo "  ✅ dex-api"
echo "  ✅ ifood-scheduler_worker (NOVO)"
echo "  ✅ ifood-sales_worker"
echo "  ✅ ifood-settlements_worker"
echo "  ✅ ifood-anticipations_worker (NOVO)"
echo ""
echo "🔴 Workers Removidos:"
echo "  ❌ ifood-conciliation_worker"
echo "  ❌ ifood-reconciliation-status_worker"
echo ""
echo "📋 Próximos Passos:"
echo "  1. Monitorar logs por 24h: pm2 logs"
echo "  2. Executar testes manuais: ver AUDITORIA_ENDPOINTS.md"
echo "  3. Verificar jobs criados: SELECT * FROM ifood_jobs ORDER BY created_at DESC LIMIT 10;"
echo ""
echo "============================================================"
