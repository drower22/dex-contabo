#!/bin/bash
# Script de diagnóstico que detecta automaticamente o diretório do projeto
# Execute no servidor: bash DIAGNOSE_SERVER_AUTO.sh

set -e

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="diagnostic_${TIMESTAMP}.log"

echo "🔍 DIAGNÓSTICO COMPLETO - API DEX CONTABO (AUTO-DETECT)" | tee -a "$LOG_FILE"
echo "Timestamp: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Detectar diretório do projeto
echo "📁 DETECTANDO DIRETÓRIO DO PROJETO..." | tee -a "$LOG_FILE"
echo "--------------------------------------" | tee -a "$LOG_FILE"

PROJECT_DIR=""

# Possíveis localizações
POSSIBLE_DIRS=(
    "/var/www/dex-contabo"
    "/home/$(whoami)/dex-contabo"
    "/opt/dex-contabo"
    "/root/dex-contabo"
    "$(pwd)"
    "/var/www/html/dex-contabo"
    "/usr/local/dex-contabo"
)

# Tentar encontrar pelo PM2
if command -v pm2 &> /dev/null; then
    PM2_DIR=$(pm2 describe dex-api 2>/dev/null | grep "script path" | awk '{print $4}' | xargs dirname 2>/dev/null || echo "")
    if [ -n "$PM2_DIR" ] && [ -d "$PM2_DIR" ]; then
        POSSIBLE_DIRS=("$PM2_DIR" "${POSSIBLE_DIRS[@]}")
    fi
fi

# Procurar em cada localização
for dir in "${POSSIBLE_DIRS[@]}"; do
    if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
        # Verificar se é o projeto correto
        if grep -q "dex-backend-contabo" "$dir/package.json" 2>/dev/null || \
           grep -q "ifood-auth" "$dir/package.json" 2>/dev/null || \
           [ -d "$dir/api/ifood-auth" ]; then
            PROJECT_DIR="$dir"
            echo "✅ Projeto encontrado em: $PROJECT_DIR" | tee -a "$LOG_FILE"
            break
        fi
    fi
done

if [ -z "$PROJECT_DIR" ]; then
    echo "❌ Projeto não encontrado automaticamente" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Por favor, informe o caminho correto:" | tee -a "$LOG_FILE"
    read -p "Caminho do projeto: " PROJECT_DIR
    
    if [ ! -d "$PROJECT_DIR" ]; then
        echo "❌ Diretório não existe: $PROJECT_DIR" | tee -a "$LOG_FILE"
        exit 1
    fi
fi

echo "Usando diretório: $PROJECT_DIR" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 1. INFORMAÇÕES DO SISTEMA
echo "📊 1. INFORMAÇÕES DO SISTEMA" | tee -a "$LOG_FILE"
echo "----------------------------" | tee -a "$LOG_FILE"
echo "Hostname: $(hostname)" | tee -a "$LOG_FILE"
echo "User: $(whoami)" | tee -a "$LOG_FILE"
echo "Uptime: $(uptime)" | tee -a "$LOG_FILE"
echo "Memória:" | tee -a "$LOG_FILE"
free -h | tee -a "$LOG_FILE"
echo "Disco:" | tee -a "$LOG_FILE"
df -h / | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 2. PROCESSOS PM2
echo "🔄 2. STATUS DOS PROCESSOS PM2" | tee -a "$LOG_FILE"
echo "--------------------------------" | tee -a "$LOG_FILE"
if command -v pm2 &> /dev/null; then
    pm2 list | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Detalhes do processo dex-api:" | tee -a "$LOG_FILE"
    pm2 describe dex-api 2>&1 | tee -a "$LOG_FILE" || echo "❌ Processo dex-api não encontrado" | tee -a "$LOG_FILE"
else
    echo "❌ PM2 não instalado" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 3. LOGS DO PM2 (últimas 100 linhas)
echo "📝 3. LOGS DO PM2 (últimas 100 linhas)" | tee -a "$LOG_FILE"
echo "---------------------------------------" | tee -a "$LOG_FILE"
if command -v pm2 &> /dev/null; then
    echo "=== LOGS DE SAÍDA ===" | tee -a "$LOG_FILE"
    pm2 logs dex-api --lines 100 --nostream --out 2>&1 | tee -a "$LOG_FILE" || echo "Sem logs de saída" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "=== LOGS DE ERRO ===" | tee -a "$LOG_FILE"
    pm2 logs dex-api --lines 100 --nostream --err 2>&1 | tee -a "$LOG_FILE" || echo "Sem logs de erro" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 4. PORTAS E CONEXÕES
echo "🔌 4. PORTAS E CONEXÕES" | tee -a "$LOG_FILE"
echo "------------------------" | tee -a "$LOG_FILE"
echo "Porta 3000 (API):" | tee -a "$LOG_FILE"
sudo lsof -i :3000 2>&1 | tee -a "$LOG_FILE" || echo "❌ Porta 3000 não está em uso" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Porta 80 (HTTP):" | tee -a "$LOG_FILE"
sudo lsof -i :80 2>&1 | tee -a "$LOG_FILE" || echo "Porta 80 não está em uso" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Porta 443 (HTTPS):" | tee -a "$LOG_FILE"
sudo lsof -i :443 2>&1 | tee -a "$LOG_FILE" || echo "Porta 443 não está em uso" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 5. NGINX STATUS
echo "🌐 5. STATUS DO NGINX" | tee -a "$LOG_FILE"
echo "----------------------" | tee -a "$LOG_FILE"
if command -v nginx &> /dev/null; then
    echo "Versão do Nginx:" | tee -a "$LOG_FILE"
    nginx -v 2>&1 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Teste de configuração:" | tee -a "$LOG_FILE"
    sudo nginx -t 2>&1 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Status do serviço:" | tee -a "$LOG_FILE"
    sudo systemctl status nginx --no-pager 2>&1 | tee -a "$LOG_FILE"
else
    echo "❌ Nginx não instalado" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 6. CONFIGURAÇÃO DO NGINX PARA API
echo "⚙️  6. CONFIGURAÇÃO DO NGINX (api.usa-dex.com.br)" | tee -a "$LOG_FILE"
echo "--------------------------------------------------" | tee -a "$LOG_FILE"
if [ -d "/etc/nginx/sites-enabled" ]; then
    echo "Arquivos de configuração:" | tee -a "$LOG_FILE"
    ls -la /etc/nginx/sites-enabled/ | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Configuração da API:" | tee -a "$LOG_FILE"
    sudo grep -r "api.usa-dex.com.br" /etc/nginx/sites-enabled/ 2>&1 | tee -a "$LOG_FILE" || echo "❌ Configuração não encontrada" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Upstream para localhost:3000:" | tee -a "$LOG_FILE"
    sudo grep -r "localhost:3000" /etc/nginx/sites-enabled/ 2>&1 | tee -a "$LOG_FILE" || echo "❌ Upstream não encontrado" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 7. LOGS DO NGINX (últimas 50 linhas)
echo "📋 7. LOGS DO NGINX" | tee -a "$LOG_FILE"
echo "--------------------" | tee -a "$LOG_FILE"
if [ -f "/var/log/nginx/error.log" ]; then
    echo "=== ERROS (últimas 50 linhas) ===" | tee -a "$LOG_FILE"
    sudo tail -n 50 /var/log/nginx/error.log | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
fi
if [ -f "/var/log/nginx/access.log" ]; then
    echo "=== ACESSOS (últimas 30 linhas) ===" | tee -a "$LOG_FILE"
    sudo tail -n 30 /var/log/nginx/access.log | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "=== ERROS 4xx/5xx (última hora) ===" | tee -a "$LOG_FILE"
    sudo awk -v d="$(date -u -d '1 hour ago' '+%d/%b/%Y:%H')" '$4 ~ d && ($9 ~ /^4/ || $9 ~ /^5/)' /var/log/nginx/access.log | tail -n 50 | tee -a "$LOG_FILE" || echo "Nenhum erro encontrado" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 8. DIRETÓRIO DO PROJETO
echo "📁 8. DIRETÓRIO DO PROJETO" | tee -a "$LOG_FILE"
echo "---------------------------" | tee -a "$LOG_FILE"
if [ -d "$PROJECT_DIR" ]; then
    echo "Conteúdo de $PROJECT_DIR:" | tee -a "$LOG_FILE"
    ls -la "$PROJECT_DIR" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Estrutura da API:" | tee -a "$LOG_FILE"
    ls -la "$PROJECT_DIR/api/" 2>&1 | tee -a "$LOG_FILE" || echo "Diretório api/ não existe" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "Arquivo .env:" | tee -a "$LOG_FILE"
    if [ -f "$PROJECT_DIR/.env" ]; then
        echo "✅ .env existe" | tee -a "$LOG_FILE"
        echo "Variáveis configuradas (sem valores sensíveis):" | tee -a "$LOG_FILE"
        grep -v "^#" "$PROJECT_DIR/.env" | grep -v "^$" | cut -d'=' -f1 | tee -a "$LOG_FILE"
    else
        echo "❌ .env NÃO EXISTE" | tee -a "$LOG_FILE"
    fi
else
    echo "❌ Diretório $PROJECT_DIR não existe" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 9. TESTES DE CONECTIVIDADE
echo "🧪 9. TESTES DE CONECTIVIDADE" | tee -a "$LOG_FILE"
echo "--------------------------------" | tee -a "$LOG_FILE"
echo "=== Teste 1: Health check local (localhost:3000) ===" | tee -a "$LOG_FILE"
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" http://localhost:3000/api/ifood-auth/health 2>&1 | tee -a "$LOG_FILE" || echo "❌ Falhou" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "=== Teste 2: Health check via domínio (api.usa-dex.com.br) ===" | tee -a "$LOG_FILE"
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" https://api.usa-dex.com.br/api/ifood-auth/health 2>&1 | tee -a "$LOG_FILE" || echo "❌ Falhou" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 10. VERIFICAÇÃO DE DEPENDÊNCIAS
echo "📦 10. DEPENDÊNCIAS NODE.JS" | tee -a "$LOG_FILE"
echo "----------------------------" | tee -a "$LOG_FILE"
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
    echo "Node version:" | tee -a "$LOG_FILE"
    node -v 2>&1 | tee -a "$LOG_FILE" || echo "❌ Node não instalado" | tee -a "$LOG_FILE"
    echo "NPM version:" | tee -a "$LOG_FILE"
    npm -v 2>&1 | tee -a "$LOG_FILE" || echo "❌ NPM não instalado" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "node_modules:" | tee -a "$LOG_FILE"
    if [ -d "node_modules" ]; then
        echo "✅ node_modules existe ($(du -sh node_modules 2>/dev/null | cut -f1))" | tee -a "$LOG_FILE"
    else
        echo "❌ node_modules NÃO EXISTE" | tee -a "$LOG_FILE"
    fi
fi
echo "" | tee -a "$LOG_FILE"

# 11. RESUMO
echo "📊 11. RESUMO DO DIAGNÓSTICO" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Diretório do projeto: $PROJECT_DIR" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Verificar problemas comuns
ISSUES=0

if ! command -v pm2 &> /dev/null; then
    echo "❌ PROBLEMA: PM2 não instalado" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if ! pm2 describe dex-api &> /dev/null; then
    echo "❌ PROBLEMA: Processo dex-api não está rodando no PM2" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if ! sudo lsof -i :3000 &> /dev/null; then
    echo "❌ PROBLEMA: Porta 3000 não está em uso (API não está escutando)" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if ! sudo nginx -t &> /dev/null; then
    echo "❌ PROBLEMA: Configuração do Nginx inválida" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "❌ PROBLEMA: Arquivo .env não existe" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "❌ PROBLEMA: node_modules não existe (dependências não instaladas)" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if [ $ISSUES -eq 0 ]; then
    echo "✅ Nenhum problema crítico detectado" | tee -a "$LOG_FILE"
else
    echo "⚠️  Total de problemas encontrados: $ISSUES" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "✅ Diagnóstico completo salvo em: $LOG_FILE" | tee -a "$LOG_FILE"
echo "📤 Envie este arquivo para análise detalhada" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
