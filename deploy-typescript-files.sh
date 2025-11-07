#!/bin/bash
# Script para fazer upload dos arquivos TypeScript para o Contabo

SERVER="root@89.116.29.187"
REMOTE_DIR="/var/www/dex-contabo"

echo "🚀 Fazendo upload dos arquivos TypeScript para o Contabo..."

# 1. Upload do ecosystem.config.js corrigido
echo "📦 Uploading ecosystem.config.js..."
scp ecosystem.config.js $SERVER:$REMOTE_DIR/

# 2. Upload do server.ts
echo "📦 Uploading api/server.ts..."
scp api/server.ts $SERVER:$REMOTE_DIR/api/

# 3. Upload dos handlers TypeScript
echo "📦 Uploading TypeScript handlers..."
scp api/ifood-auth/*.ts $SERVER:$REMOTE_DIR/api/ifood-auth/

# 4. Upload do tsconfig.json
echo "📦 Uploading tsconfig.json..."
scp tsconfig.json $SERVER:$REMOTE_DIR/

# 5. Upload do package.json (garantir que ts-node está nas dependências)
echo "📦 Uploading package.json..."
scp package.json $SERVER:$REMOTE_DIR/

echo ""
echo "✅ Upload concluído!"
echo ""
echo "Agora execute no servidor:"
echo "  ssh $SERVER"
echo "  cd $REMOTE_DIR"
echo "  npm install"
echo "  pm2 start ecosystem.config.js"
echo "  pm2 save"
echo "  pm2 logs dex-api --lines 30"
