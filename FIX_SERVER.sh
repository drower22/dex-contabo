#!/bin/bash
# ============================================================================
# Script de Correção do Servidor Contabo
# ============================================================================
# Execute como ROOT no servidor: bash FIX_SERVER.sh
# ============================================================================

set -e

echo "🔧 Iniciando correção do servidor..."

# 1. Parar TODOS os processos PM2 (root e dex)
echo "1️⃣ Parando todos os PM2..."
pm2 kill || true
sudo -u dex pm2 kill || true

# 2. Matar processos node órfãos
echo "2️⃣ Matando processos node órfãos..."
pkill -9 -f "node.*dex-app" || true
sleep 2

# 3. Corrigir permissões do diretório
echo "3️⃣ Corrigindo permissões..."
chown -R dex:dex /home/dex/dex-app
chmod 755 /home/dex/dex-app

# 4. Limpar node_modules e reinstalar
echo "4️⃣ Limpando e reinstalando dependências..."
cd /home/dex/dex-app
rm -rf node_modules package-lock.json
sudo -u dex npm install

# 5. Iniciar PM2 como usuário dex
echo "5️⃣ Iniciando PM2 como dex..."
sudo -u dex bash << 'EOF'
cd /home/dex/dex-app
pm2 delete all 2>/dev/null || true
pm2 start api/server.ts --name dex-api --interpreter ts-node --instances 2 --env production
pm2 save
pm2 startup
EOF

# 6. Verificar status
echo "6️⃣ Verificando status..."
sudo -u dex pm2 status

echo ""
echo "✅ Correção concluída!"
echo ""
echo "📊 Processos node rodando:"
ps aux | grep node | grep -v grep

echo ""
echo "🧪 Teste a API:"
echo "curl http://localhost:3000/api/ifood-auth/health"
