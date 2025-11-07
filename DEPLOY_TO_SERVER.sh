#!/bin/bash
# Script para copiar os arquivos de diagnóstico para o servidor Contabo
# Execute na sua máquina local

SERVER="root@89.116.29.187"
PROJECT_DIR="/home/dex/dex-app"

echo "📤 Copiando scripts de diagnóstico para o servidor..."
echo ""

# Copiar scripts
scp DIAGNOSE_SERVER_AUTO.sh ${SERVER}:${PROJECT_DIR}/
scp QUICK_FIX.sh ${SERVER}:${PROJECT_DIR}/
scp FIND_PROJECT.sh ${SERVER}:${PROJECT_DIR}/
scp TROUBLESHOOTING_GUIDE.md ${SERVER}:${PROJECT_DIR}/
scp COMO_DEBUGAR.md ${SERVER}:${PROJECT_DIR}/

echo ""
echo "✅ Scripts copiados!"
echo ""
echo "Agora execute no servidor:"
echo "  ssh ${SERVER}"
echo "  cd ${PROJECT_DIR}"
echo "  bash DIAGNOSE_SERVER_AUTO.sh"
