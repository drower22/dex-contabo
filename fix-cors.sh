#!/bin/bash
# Script para corrigir CORS no backend Contabo

echo "🔧 Corrigindo CORS no backend Contabo..."

# Atualizar .env para aceitar qualquer origem em desenvolvimento
cd /home/dex/dex-app || exit 1

# Backup do .env atual
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Atualizar CORS_ORIGIN para aceitar qualquer origem
if grep -q "CORS_ORIGIN=" .env; then
  sed -i 's/^CORS_ORIGIN=.*/CORS_ORIGIN=*/' .env
  echo "✅ CORS_ORIGIN atualizado para '*'"
else
  echo "CORS_ORIGIN=*" >> .env
  echo "✅ CORS_ORIGIN adicionado ao .env"
fi

# Reiniciar o servidor PM2
pm2 restart dex-api

echo "✅ Servidor reiniciado com novo CORS"
echo ""
echo "📋 Verificar logs:"
echo "   pm2 logs dex-api --lines 50"
