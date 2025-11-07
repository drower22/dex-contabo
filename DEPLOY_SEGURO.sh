#!/bin/bash
# Script de deploy seguro para GitHub com workflow automático
# Execute na sua máquina local

set -e

REPO_DIR="/home/ismar/Área de trabalho/dex-frontend-main (APi iFood)/dex-contabo"
cd "$REPO_DIR"

echo "🚀 DEPLOY SEGURO PARA GITHUB + CONTABO"
echo "======================================="
echo ""

# 1. Verificar repositório
echo "1️⃣  Verificando repositório..."
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$CURRENT_REMOTE" == *"drower22/dex-contabo"* ]]; then
    echo "✅ Repositório: $CURRENT_REMOTE"
else
    echo "❌ Repositório incorreto: $CURRENT_REMOTE"
    echo "   Esperado: git@github.com:drower22/dex-contabo.git"
    exit 1
fi
echo ""

# 2. Verificar branch
echo "2️⃣  Verificando branch..."
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Você está em: $CURRENT_BRANCH"
    echo "   Mudando para main..."
    git checkout main
    git pull origin main
fi
echo "✅ Branch: main"
echo ""

# 3. Status
echo "3️⃣  Arquivos modificados/novos..."
git status --short
echo ""

# 4. Adicionar arquivos JavaScript
echo "4️⃣  Adicionando arquivos para commit..."
git add api/server-node.js
git add api/_shared/crypto.js
git add api/ifood-auth/health.js
git add ecosystem.config-node.js
git add .github/workflows/deploy.yml
git add MIGRATE_TO_JS.sh
git add GUIA_MIGRACAO_JS.md
git add QUANDO_REMOVER_TS.md
git add DEPLOY_SEGURO.sh
echo "✅ Arquivos adicionados"
echo ""

# 5. Decisão sobre arquivos TypeScript
echo "5️⃣  Arquivos TypeScript..."
echo ""
echo "OPÇÕES:"
echo "  1) Manter .ts como backup (RECOMENDADO)"
echo "  2) Remover .ts agora"
echo ""
read -p "Escolha (1 ou 2): " -n 1 -r
echo ""

if [[ $REPLY == "2" ]]; then
    echo "   Removendo arquivos TypeScript..."
    git rm api/server.ts 2>/dev/null || true
    git rm api/_shared/crypto.ts 2>/dev/null || true
    git rm api/ifood-auth/health.ts 2>/dev/null || true
    
    # Renomear ecosystem.config-node.js para ecosystem.config.js
    git rm ecosystem.config.js 2>/dev/null || true
    git mv ecosystem.config-node.js ecosystem.config.js 2>/dev/null || true
    
    echo "✅ Arquivos TypeScript removidos"
    COMMIT_MSG="feat: Migrar API para JavaScript puro (remove TypeScript)

- Converte server.ts → server.js (Node.js puro)
- Converte crypto.ts → crypto.js (usa crypto.webcrypto)
- Converte health.ts → health.js
- Remove ts-node do ecosystem.config.js
- Atualiza workflow de deploy para JavaScript
- Adiciona scripts de migração e documentação

Benefícios:
- ~30-50% mais rápido
- Menor uso de memória
- Deploy mais simples
- Resolve 'handler is not a function'
- Resolve 'crypto is not defined'

Breaking Changes:
- Requer Node.js 18+
- Remove ts-node em produção"
else
    echo "✅ Mantendo arquivos TypeScript como backup"
    COMMIT_MSG="feat: Adicionar versão JavaScript da API (mantém TypeScript)

- Adiciona server-node.js (versão JavaScript do server.ts)
- Adiciona crypto.js (versão JavaScript do crypto.ts)
- Adiciona health.js (versão JavaScript do health.ts)
- Adiciona ecosystem.config-node.js para Node.js puro
- Atualiza workflow de deploy com suporte a JavaScript
- Adiciona scripts de migração e documentação

Próximos passos:
- Testar em produção por 1 semana
- Remover arquivos .ts após validação

Benefícios esperados:
- ~30-50% mais rápido
- Menor uso de memória
- Deploy mais simples"
fi
echo ""

# 6. Commit
echo "6️⃣  Criando commit..."
echo ""
echo "Mensagem do commit:"
echo "-------------------"
echo "$COMMIT_MSG"
echo "-------------------"
echo ""
read -p "Confirmar commit? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    git commit -m "$COMMIT_MSG"
    echo "✅ Commit criado"
else
    echo "❌ Commit cancelado"
    exit 1
fi
echo ""

# 7. Push
echo "7️⃣  Enviando para GitHub..."
echo ""
echo "⚠️  ATENÇÃO: Isso vai disparar o workflow de deploy automático!"
echo "   O GitHub Actions vai:"
echo "   1. Fazer backup automático no servidor"
echo "   2. Atualizar o código"
echo "   3. Instalar dependências"
echo "   4. Reiniciar PM2"
echo "   5. Testar health check"
echo "   6. Fazer rollback se falhar"
echo ""
read -p "Fazer push e iniciar deploy? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin main
    echo ""
    echo "✅ Push concluído!"
    echo ""
    echo "======================================="
    echo "🎉 DEPLOY INICIADO!"
    echo "======================================="
    echo ""
    echo "Acompanhe o deploy em:"
    echo "https://github.com/drower22/dex-contabo/actions"
    echo ""
    echo "O workflow vai:"
    echo "  1. ✅ Fazer backup automático"
    echo "  2. ✅ Atualizar código no servidor"
    echo "  3. ✅ Instalar dependências"
    echo "  4. ✅ Reiniciar PM2"
    echo "  5. ✅ Testar health check"
    echo "  6. ✅ Rollback automático se falhar"
    echo ""
    echo "Após o deploy (2-3 minutos):"
    echo "  curl https://api.usa-dex.com.br/api/ifood-auth/health"
    echo ""
    echo "Monitorar logs no servidor:"
    echo "  ssh root@89.116.29.187"
    echo "  pm2 logs dex-api"
    echo "======================================="
else
    echo "⏭️  Push cancelado"
    echo ""
    echo "Para fazer push manualmente:"
    echo "  git push origin main"
fi
