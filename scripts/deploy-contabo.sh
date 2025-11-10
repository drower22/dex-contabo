#!/bin/bash

# Script para deploy no Contabo
# Uso: ./deploy-contabo.sh

echo "🚀 Iniciando deploy no Contabo..."

# Conectar ao servidor e executar comandos
ssh dex@5.161.186.26 << 'ENDSSH'
  echo "📂 Navegando para diretório da aplicação..."
  cd /home/dex/dex-app || exit 1
  
  echo "📥 Fazendo pull das mudanças..."
  git pull origin main
  
  echo "📦 Instalando dependências (se necessário)..."
  npm install --production
  
  echo "🔄 Reiniciando API com PM2..."
  pm2 restart dex-api
  
  echo "📊 Status do PM2..."
  pm2 status
  
  echo "📝 Últimas linhas do log..."
  pm2 logs dex-api --lines 20 --nostream
  
  echo "✅ Deploy concluído!"
ENDSSH

echo ""
echo "🎯 Deploy finalizado! Verifique os logs acima."
echo "📍 API disponível em: https://api.usa-dex.com.br/api"
echo "🔍 Para ver logs em tempo real: ssh dex@5.161.186.26 'pm2 logs dex-api'"
