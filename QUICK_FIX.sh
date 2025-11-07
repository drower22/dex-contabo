#!/bin/bash
# Script de correção rápida para problemas comuns da API
# Execute no servidor: bash QUICK_FIX.sh

set -e

PROJECT_DIR="/var/www/dex-contabo"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔧 QUICK FIX - API DEX CONTABO"
echo "=============================="
echo ""

# Função para verificar se comando existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Função para printar status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# 1. Verificar PM2
echo "1️⃣  Verificando PM2..."
if command_exists pm2; then
    print_status 0 "PM2 instalado"
else
    print_status 1 "PM2 não instalado"
    echo "   Instalando PM2..."
    npm install -g pm2
fi

# 2. Verificar diretório do projeto
echo ""
echo "2️⃣  Verificando diretório do projeto..."
if [ -d "$PROJECT_DIR" ]; then
    print_status 0 "Diretório existe: $PROJECT_DIR"
    cd "$PROJECT_DIR"
else
    print_status 1 "Diretório não existe: $PROJECT_DIR"
    echo "   Por favor, clone o repositório em $PROJECT_DIR"
    exit 1
fi

# 3. Verificar node_modules
echo ""
echo "3️⃣  Verificando dependências..."
if [ -d "node_modules" ]; then
    print_status 0 "node_modules existe"
else
    print_status 1 "node_modules não existe"
    echo "   Instalando dependências..."
    npm install
fi

# 4. Verificar .env
echo ""
echo "4️⃣  Verificando arquivo .env..."
if [ -f ".env" ]; then
    print_status 0 ".env existe"
    
    # Verificar variáveis críticas
    echo "   Verificando variáveis críticas..."
    
    if grep -q "SUPABASE_URL=" .env && [ -n "$(grep "SUPABASE_URL=" .env | cut -d'=' -f2)" ]; then
        print_status 0 "SUPABASE_URL configurado"
    else
        print_status 1 "SUPABASE_URL não configurado"
    fi
    
    if grep -q "SUPABASE_SERVICE_ROLE_KEY=" .env && [ -n "$(grep "SUPABASE_SERVICE_ROLE_KEY=" .env | cut -d'=' -f2)" ]; then
        print_status 0 "SUPABASE_SERVICE_ROLE_KEY configurado"
    else
        print_status 1 "SUPABASE_SERVICE_ROLE_KEY não configurado"
    fi
    
    if grep -q "ENCRYPTION_KEY=" .env && [ -n "$(grep "ENCRYPTION_KEY=" .env | cut -d'=' -f2)" ]; then
        print_status 0 "ENCRYPTION_KEY configurado"
    else
        print_status 1 "ENCRYPTION_KEY não configurado"
        echo "   Gerando ENCRYPTION_KEY..."
        ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
        echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
        print_status 0 "ENCRYPTION_KEY gerado e adicionado ao .env"
    fi
    
    if grep -q "IFOOD_CLIENT_ID" .env && [ -n "$(grep "IFOOD_CLIENT_ID" .env | head -1 | cut -d'=' -f2)" ]; then
        print_status 0 "IFOOD_CLIENT_ID configurado"
    else
        print_status 1 "IFOOD_CLIENT_ID não configurado"
    fi
    
else
    print_status 1 ".env não existe"
    echo "   Criando .env a partir do template..."
    
    if [ -f "env.example" ]; then
        cp env.example .env
        print_status 0 ".env criado"
        
        # Gerar chaves
        echo "   Gerando chaves de segurança..."
        ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
        CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        
        # Adicionar ao .env
        echo "" >> .env
        echo "# Chaves geradas automaticamente" >> .env
        echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
        echo "CRON_SECRET=$CRON_SECRET" >> .env
        
        print_status 0 "Chaves geradas"
        echo -e "${YELLOW}⚠️  ATENÇÃO: Configure as outras variáveis no .env:${NC}"
        echo "   - SUPABASE_URL"
        echo "   - SUPABASE_SERVICE_ROLE_KEY"
        echo "   - IFOOD_CLIENT_ID_REVIEWS"
        echo "   - IFOOD_CLIENT_SECRET_REVIEWS"
        echo "   - IFOOD_CLIENT_ID_FINANCIAL"
        echo "   - IFOOD_CLIENT_SECRET_FINANCIAL"
        echo "   - CORS_ORIGIN"
    else
        print_status 1 "env.example não encontrado"
        exit 1
    fi
fi

# 5. Limpar processos na porta 3000
echo ""
echo "5️⃣  Limpando porta 3000..."
if sudo lsof -i :3000 > /dev/null 2>&1; then
    echo "   Matando processos na porta 3000..."
    sudo kill -9 $(sudo lsof -t -i:3000) 2>/dev/null || true
    sleep 2
    print_status 0 "Porta 3000 liberada"
else
    print_status 0 "Porta 3000 já está livre"
fi

# 6. Parar processo PM2 antigo
echo ""
echo "6️⃣  Parando processo PM2 antigo..."
if pm2 describe dex-api > /dev/null 2>&1; then
    pm2 delete dex-api
    print_status 0 "Processo antigo removido"
else
    print_status 0 "Nenhum processo antigo encontrado"
fi

# 7. Iniciar novo processo
echo ""
echo "7️⃣  Iniciando novo processo..."
if [ -f "ecosystem.config.js" ]; then
    pm2 start ecosystem.config.js
    pm2 save
    print_status 0 "Processo iniciado"
else
    print_status 1 "ecosystem.config.js não encontrado"
    exit 1
fi

# 8. Aguardar inicialização
echo ""
echo "8️⃣  Aguardando inicialização (5 segundos)..."
sleep 5

# 9. Verificar se processo está rodando
echo ""
echo "9️⃣  Verificando status do processo..."
if pm2 describe dex-api | grep -q "online"; then
    print_status 0 "Processo está online"
else
    print_status 1 "Processo não está online"
    echo "   Logs de erro:"
    pm2 logs dex-api --err --lines 20
    exit 1
fi

# 10. Testar health check
echo ""
echo "🔟 Testando health check..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/ifood-auth/health)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$HEALTH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "Health check respondeu com 200"
    echo "   Response:"
    echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
else
    print_status 1 "Health check falhou (HTTP $HTTP_CODE)"
    echo "   Response:"
    echo "$RESPONSE_BODY"
fi

# 11. Verificar Nginx
echo ""
echo "1️⃣1️⃣  Verificando Nginx..."
if command_exists nginx; then
    if sudo nginx -t > /dev/null 2>&1; then
        print_status 0 "Configuração do Nginx válida"
        
        if sudo systemctl is-active --quiet nginx; then
            print_status 0 "Nginx está rodando"
        else
            print_status 1 "Nginx não está rodando"
            echo "   Iniciando Nginx..."
            sudo systemctl start nginx
            print_status 0 "Nginx iniciado"
        fi
    else
        print_status 1 "Configuração do Nginx inválida"
        sudo nginx -t
    fi
else
    print_status 1 "Nginx não instalado"
fi

# 12. Resumo final
echo ""
echo "=============================="
echo "📊 RESUMO"
echo "=============================="
echo ""

pm2 list

echo ""
echo "🔗 URLs para testar:"
echo "   Local:    http://localhost:3000/api/ifood-auth/health"
echo "   Externo:  https://api.usa-dex.com.br/api/ifood-auth/health"
echo ""

echo "📝 Comandos úteis:"
echo "   Ver logs:        pm2 logs dex-api"
echo "   Reiniciar:       pm2 restart dex-api"
echo "   Status:          pm2 describe dex-api"
echo "   Monitorar:       pm2 monit"
echo ""

echo -e "${GREEN}✅ Quick fix concluído!${NC}"
echo ""

# Testar endpoint externo se Nginx estiver rodando
if command_exists nginx && sudo systemctl is-active --quiet nginx; then
    echo "🌐 Testando endpoint externo..."
    EXTERNAL_RESPONSE=$(curl -s -w "\n%{http_code}" https://api.usa-dex.com.br/api/ifood-auth/health 2>/dev/null || echo "FAILED")
    if echo "$EXTERNAL_RESPONSE" | tail -n1 | grep -q "200"; then
        print_status 0 "Endpoint externo funcionando"
    else
        print_status 1 "Endpoint externo não está acessível"
        echo "   Verifique:"
        echo "   - DNS está apontando para este servidor?"
        echo "   - Firewall permite tráfego nas portas 80/443?"
        echo "   - Certificado SSL está válido?"
    fi
fi

echo ""
echo "=============================="
