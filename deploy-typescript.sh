#!/bin/bash

# Script de deploy TypeScript para Contabo
# Uso: ./deploy-typescript.sh

set -e  # Parar em caso de erro

echo "🔷 Deploy TypeScript - Dex Contabo API"
echo "========================================"
echo ""

# Verificar se está no diretório correto
if [ ! -f "package.json" ]; then
  echo "❌ Erro: Execute este script no diretório dex-contabo/"
  exit 1
fi

# 1. Atualizar código
echo "📥 1. Atualizando código do repositório..."
git pull origin main || {
  echo "⚠️  Aviso: git pull falhou, continuando..."
}
echo ""

# 2. Instalar dependências
echo "📦 2. Instalando dependências (incluindo ts-node)..."
npm install
echo ""

# 3. Verificar ts-node
echo "🔍 3. Verificando ts-node..."
if npx ts-node --version > /dev/null 2>&1; then
  echo "✅ ts-node instalado: $(npx ts-node --version)"
else
  echo "❌ Erro: ts-node não encontrado"
  exit 1
fi
echo ""

# 4. Verificar variáveis de ambiente
echo "🔐 4. Verificando variáveis de ambiente..."
if [ ! -f ".env" ]; then
  echo "⚠️  Aviso: Arquivo .env não encontrado"
  echo "   Copie env.example para .env e configure as variáveis"
  echo "   cp env.example .env"
  echo "   nano .env"
else
  echo "✅ Arquivo .env encontrado"
  
  # Verificar variáveis críticas
  source .env
  
  if [ -z "$SUPABASE_URL" ]; then
    echo "⚠️  Aviso: SUPABASE_URL não configurada"
  fi
  
  if [ -z "$IFOOD_CLIENT_ID_REVIEWS" ] && [ -z "$IFOOD_CLIENT_ID" ]; then
    echo "⚠️  Aviso: IFOOD_CLIENT_ID não configurada"
  fi
fi
echo ""

# 5. Testar TypeScript
echo "🧪 5. Testando compilação TypeScript..."
npm run type-check || {
  echo "⚠️  Aviso: Erros de tipo encontrados, mas continuando..."
}
echo ""

# 6. Parar PM2 (se estiver rodando)
echo "🛑 6. Parando instância anterior do PM2..."
pm2 stop dex-api 2>/dev/null || echo "   (Nenhuma instância rodando)"
pm2 delete dex-api 2>/dev/null || echo "   (Nenhuma instância para deletar)"
echo ""

# 7. Iniciar com PM2
echo "🚀 7. Iniciando servidor TypeScript com PM2..."
npm run pm2:start
echo ""

# 8. Aguardar inicialização
echo "⏳ 8. Aguardando inicialização (5 segundos)..."
sleep 5
echo ""

# 9. Verificar status
echo "📊 9. Verificando status do PM2..."
pm2 status
echo ""

# 10. Mostrar logs
echo "📝 10. Últimas linhas do log:"
pm2 logs dex-api --lines 20 --nostream
echo ""

# 11. Testar health check
echo "🏥 11. Testando health check..."
if command -v curl > /dev/null 2>&1; then
  echo "   Testando: http://localhost:3000/api/health"
  curl -s http://localhost:3000/api/health | jq '.' || curl -s http://localhost:3000/api/health
  echo ""
else
  echo "   (curl não instalado, pulando teste)"
fi
echo ""

# 12. Salvar configuração PM2
echo "💾 12. Salvando configuração PM2..."
pm2 save
echo ""

# Resumo
echo "========================================"
echo "✅ Deploy concluído com sucesso!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Verificar logs: pm2 logs dex-api"
echo "   2. Testar endpoint: curl https://api.usa-dex.com.br/api/health"
echo "   3. Testar link: curl -X POST https://api.usa-dex.com.br/api/ifood-auth/link?scope=financial -H 'Content-Type: application/json' -d '{\"merchantId\":\"111\"}'"
echo ""
echo "🔧 Comandos úteis:"
echo "   pm2 status              - Ver status"
echo "   pm2 logs dex-api        - Ver logs"
echo "   pm2 restart dex-api     - Reiniciar"
echo "   pm2 monit               - Monitorar"
echo ""
