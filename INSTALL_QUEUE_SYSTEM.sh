#!/bin/bash

echo "🚀 Instalando Sistema de Filas para Sync de Vendas iFood"
echo "=========================================================="

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 1. Instalar Redis
echo ""
echo "${YELLOW}📦 Passo 1: Instalando Redis...${NC}"
sudo apt update
sudo apt install redis-server -y

# Configurar Redis para iniciar automaticamente
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verificar se Redis está rodando
if redis-cli ping > /dev/null 2>&1; then
    echo "${GREEN}✅ Redis instalado e rodando${NC}"
else
    echo "${RED}❌ Erro ao instalar Redis${NC}"
    exit 1
fi

# 2. Instalar dependências Node.js
echo ""
echo "${YELLOW}📦 Passo 2: Instalando dependências Node.js...${NC}"
cd /home/dex/dex-app
npm install

if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Dependências instaladas${NC}"
else
    echo "${RED}❌ Erro ao instalar dependências${NC}"
    exit 1
fi

# 3. Compilar TypeScript
echo ""
echo "${YELLOW}🔨 Passo 3: Compilando TypeScript...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo "${GREEN}✅ Código compilado${NC}"
else
    echo "${RED}❌ Erro ao compilar${NC}"
    exit 1
fi

# 4. Criar diretório de logs
echo ""
echo "${YELLOW}📁 Passo 4: Criando diretório de logs...${NC}"
mkdir -p /home/dex/dex-app/logs
echo "${GREEN}✅ Diretório de logs criado${NC}"

# 5. Verificar variáveis de ambiente
echo ""
echo "${YELLOW}🔍 Passo 5: Verificando variáveis de ambiente...${NC}"

if [ -f /home/dex/dex-app/.env ]; then
    echo "${GREEN}✅ Arquivo .env encontrado${NC}"
    
    # Verificar variáveis necessárias
    required_vars=("REDIS_HOST" "SUPABASE_URL" "SUPABASE_SERVICE_ROLE_KEY" "IFOOD_PROXY_BASE" "SHARED_PROXY_KEY")
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" /home/dex/dex-app/.env; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -eq 0 ]; then
        echo "${GREEN}✅ Todas as variáveis necessárias estão configuradas${NC}"
    else
        echo "${YELLOW}⚠️  Variáveis faltando no .env:${NC}"
        for var in "${missing_vars[@]}"; do
            echo "   - $var"
        done
        echo ""
        echo "${YELLOW}Adicione estas variáveis ao arquivo .env antes de continuar${NC}"
    fi
else
    echo "${RED}❌ Arquivo .env não encontrado${NC}"
    echo "Crie o arquivo /home/dex/dex-app/.env com as variáveis necessárias"
    exit 1
fi

# 6. Verificar se já existe ecosystem.config.js
echo ""
echo "${YELLOW}� Passo 6: Verificando ecosystem.config.js...${NC}"

if [ -f /home/dex/dex-app/ecosystem.config.js ]; then
    echo "${YELLOW}⚠️  Ecosystem.config.js já existe!${NC}"
    echo ""
    echo "${YELLOW}ATENÇÃO: Você precisa adicionar o worker manualmente ao seu ecosystem existente.${NC}"
    echo ""
    echo "Siga as instruções em: ${GREEN}INTEGRAR_WORKER_NO_ECOSYSTEM.md${NC}"
    echo ""
    echo "Resumo rápido:"
    echo "1. Fazer backup: cp ecosystem.config.js ecosystem.config.js.backup"
    echo "2. Editar: nano ecosystem.config.js"
    echo "3. Adicionar configuração do worker (veja o arquivo de exemplo)"
    echo "4. Recarregar PM2: pm2 reload ecosystem.config.js"
    echo ""
    read -p "Pressione ENTER para continuar ou Ctrl+C para sair..."
else
    echo "${GREEN}✅ Nenhum ecosystem.config.js encontrado${NC}"
    echo "${YELLOW}Você pode usar o ecosystem.config.js de exemplo fornecido${NC}"
fi

# 7. Recarregar PM2 (se já estiver rodando)
echo ""
echo "${YELLOW}🚀 Passo 7: Recarregando PM2...${NC}"

if pm2 list | grep -q "online"; then
    echo "${YELLOW}PM2 já está rodando. Recarregando configuração...${NC}"
    pm2 reload ecosystem.config.js 2>/dev/null || echo "${YELLOW}⚠️  Execute manualmente: pm2 reload ecosystem.config.js${NC}"
else
    echo "${YELLOW}PM2 não está rodando. Inicie manualmente com: pm2 start ecosystem.config.js${NC}"
fi

# 8. Mostrar status
echo ""
echo "${YELLOW}📊 Status dos processos:${NC}"
pm2 status

echo ""
echo "${GREEN}=========================================================="
echo "✅ Instalação concluída com sucesso!"
echo "==========================================================${NC}"
echo ""
echo "📝 Próximos passos:"
echo "   1. Verificar logs: pm2 logs"
echo "   2. Testar API de sync: curl -X POST https://api.usa-dex.com.br/api/ifood/sales/sync"
echo "   3. Monitorar Redis: redis-cli monitor"
echo ""
echo "📚 Documentação completa: IFOOD_SALES_SYNC_SETUP.md"
