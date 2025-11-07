#!/bin/bash
# Script para corrigir CORS no Nginx do Contabo

echo "🔧 Corrigindo CORS no Nginx..."

# Encontrar o arquivo de configuração do site
NGINX_SITE="/etc/nginx/sites-available/api.usa-dex.com.br"
NGINX_ENABLED="/etc/nginx/sites-enabled/api.usa-dex.com.br"

# Backup da configuração atual
sudo cp $NGINX_SITE ${NGINX_SITE}.backup.$(date +%Y%m%d_%H%M%S)

echo "📋 Procurando por configurações CORS hardcoded..."
sudo grep -n "Access-Control-Allow-Origin" $NGINX_SITE || echo "Nenhuma configuração CORS encontrada no Nginx"

echo ""
echo "⚠️  AÇÃO NECESSÁRIA:"
echo "1. Edite o arquivo de configuração do Nginx:"
echo "   sudo nano $NGINX_SITE"
echo ""
echo "2. REMOVA qualquer linha que contenha:"
echo "   - add_header Access-Control-Allow-Origin"
echo "   - add_header Access-Control-Allow-Credentials"
echo "   - add_header Access-Control-Allow-Methods"
echo "   - add_header Access-Control-Allow-Headers"
echo ""
echo "3. Deixe APENAS o proxy_pass para o Express cuidar do CORS:"
echo ""
echo "   location /api/ {"
echo "       proxy_pass http://localhost:3000;"
echo "       proxy_http_version 1.1;"
echo "       proxy_set_header Upgrade \$http_upgrade;"
echo "       proxy_set_header Connection 'upgrade';"
echo "       proxy_set_header Host \$host;"
echo "       proxy_set_header X-Real-IP \$remote_addr;"
echo "       proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "       proxy_set_header X-Forwarded-Proto \$scheme;"
echo "       proxy_cache_bypass \$http_upgrade;"
echo "   }"
echo ""
echo "4. Teste a configuração:"
echo "   sudo nginx -t"
echo ""
echo "5. Se OK, recarregue o Nginx:"
echo "   sudo systemctl reload nginx"
echo ""
echo "6. Valide o CORS:"
echo "   curl -I -H \"Origin: http://localhost:5173\" https://api.usa-dex.com.br/api/health"
echo "   Deve retornar: access-control-allow-origin: *"
