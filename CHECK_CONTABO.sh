#!/bin/bash
# Script para diagnosticar o estado do backend no Contabo

echo "=== 1. Verificar processos Node/PM2 ==="
pm2 list

echo ""
echo "=== 2. Verificar logs do PM2 (últimas 50 linhas) ==="
pm2 logs --lines 50 --nostream

echo ""
echo "=== 3. Verificar se porta 3000 está escutando ==="
sudo lsof -i :3000 || echo "Porta 3000 não está em uso"

echo ""
echo "=== 4. Testar health localmente ==="
curl -i http://localhost:3000/api/ifood-auth/health || echo "Falhou"

echo ""
echo "=== 5. Verificar config do Nginx ==="
sudo nginx -t

echo ""
echo "=== 6. Ver upstream do Nginx para api.usa-dex.com.br ==="
sudo grep -r "api.usa-dex.com.br" /etc/nginx/sites-enabled/

echo ""
echo "=== 7. Verificar diretório do projeto ==="
ls -la /var/www/dex-contabo/ 2>/dev/null || echo "Diretório não existe"

echo ""
echo "=== 8. Verificar se há .env no servidor ==="
ls -la /var/www/dex-contabo/.env 2>/dev/null || echo ".env não existe"
