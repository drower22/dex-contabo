#!/bin/bash
# Deploy manual via SSH (caso workflow não execute)

echo "🚀 Iniciando deploy manual no Contabo..."

# Variáveis (ajuste se necessário)
SERVER_USER="dex"
SERVER_HOST="api.usa-dex.com.br"
APP_DIR="/home/dex/dex-app"

# Comandos a executar no servidor
ssh ${SERVER_USER}@${SERVER_HOST} << 'ENDSSH'
set -e

echo "📂 Navegando para diretório do app..."
cd /home/dex/dex-app || exit 1

echo "📥 Atualizando código..."
git fetch --all
git reset --hard origin/main

echo "📦 Instalando dependências..."
npm ci || npm install

echo "🔄 Reiniciando PM2..."
pm2 delete dex-api || true
pm2 start ecosystem.config.js
pm2 save

echo "✅ Deploy concluído!"
echo ""
echo "📊 Status do PM2:"
pm2 status

echo ""
echo "📋 Logs (últimas 20 linhas):"
pm2 logs dex-api --lines 20 --nostream

ENDSSH

echo ""
echo "🧪 Testando endpoint /api/health..."
sleep 2
curl -s https://api.usa-dex.com.br/api/health | jq .

echo ""
echo "✅ Deploy manual finalizado!"
