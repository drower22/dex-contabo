#!/bin/bash
# Script de diagnóstico para /home/dex/dex-app
# Execute no servidor: bash DIAGNOSE_DEX_APP.sh

set -e

PROJECT_DIR="/home/dex/dex-app"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="${PROJECT_DIR}/diagnostic_${TIMESTAMP}.log"

echo "🔍 DIAGNÓSTICO COMPLETO - API DEX (/home/dex/dex-app)" | tee -a "$LOG_FILE"
echo "Timestamp: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
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
pm2 list | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Detalhes do processo dex-api (instância 0):" | tee -a "$LOG_FILE"
pm2 describe 0 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 3. LOGS DO PM2 (últimas 100 linhas)
echo "📝 3. LOGS DO PM2 (últimas 100 linhas)" | tee -a "$LOG_FILE"
echo "---------------------------------------" | tee -a "$LOG_FILE"
echo "=== LOGS DE SAÍDA ===" | tee -a "$LOG_FILE"
pm2 logs dex-api --lines 100 --nostream --out 2>&1 | tee -a "$LOG_FILE" || echo "Sem logs de saída" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "=== LOGS DE ERRO ===" | tee -a "$LOG_FILE"
pm2 logs dex-api --lines 100 --nostream --err 2>&1 | tee -a "$LOG_FILE" || echo "Sem logs de erro" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 4. LOGS DE ARQUIVO (se existirem)
echo "📄 4. LOGS DE ARQUIVO" | tee -a "$LOG_FILE"
echo "----------------------" | tee -a "$LOG_FILE"
if [ -f "${PROJECT_DIR}/logs/out.log" ]; then
    echo "=== out.log (últimas 50 linhas) ===" | tee -a "$LOG_FILE"
    tail -n 50 "${PROJECT_DIR}/logs/out.log" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
fi
if [ -f "${PROJECT_DIR}/logs/err.log" ]; then
    echo "=== err.log (últimas 50 linhas) ===" | tee -a "$LOG_FILE"
    tail -n 50 "${PROJECT_DIR}/logs/err.log" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
fi

# 5. PORTAS E CONEXÕES
echo "🔌 5. PORTAS E CONEXÕES" | tee -a "$LOG_FILE"
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

# 6. NGINX STATUS
echo "🌐 6. STATUS DO NGINX" | tee -a "$LOG_FILE"
echo "----------------------" | tee -a "$LOG_FILE"
echo "Versão do Nginx:" | tee -a "$LOG_FILE"
nginx -v 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Teste de configuração:" | tee -a "$LOG_FILE"
sudo nginx -t 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Status do serviço:" | tee -a "$LOG_FILE"
sudo systemctl status nginx --no-pager 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 7. CONFIGURAÇÃO DO NGINX
echo "⚙️  7. CONFIGURAÇÃO DO NGINX" | tee -a "$LOG_FILE"
echo "-----------------------------" | tee -a "$LOG_FILE"
echo "Arquivos de configuração:" | tee -a "$LOG_FILE"
ls -la /etc/nginx/sites-enabled/ | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Configuração da API (api.usa-dex.com.br):" | tee -a "$LOG_FILE"
sudo grep -r "api.usa-dex.com.br" /etc/nginx/sites-enabled/ 2>&1 | tee -a "$LOG_FILE" || echo "❌ Configuração não encontrada" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Upstream para localhost:3000:" | tee -a "$LOG_FILE"
sudo grep -r "localhost:3000" /etc/nginx/sites-enabled/ 2>&1 | tee -a "$LOG_FILE" || echo "❌ Upstream não encontrado" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Headers CORS configurados:" | tee -a "$LOG_FILE"
sudo grep -r "Access-Control-Allow" /etc/nginx/sites-enabled/ 2>&1 | tee -a "$LOG_FILE" || echo "⚠️  CORS não configurado no Nginx" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 8. LOGS DO NGINX
echo "📋 8. LOGS DO NGINX" | tee -a "$LOG_FILE"
echo "--------------------" | tee -a "$LOG_FILE"
echo "=== ERROS (últimas 50 linhas) ===" | tee -a "$LOG_FILE"
sudo tail -n 50 /var/log/nginx/error.log | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "=== ACESSOS (últimas 30 linhas) ===" | tee -a "$LOG_FILE"
sudo tail -n 30 /var/log/nginx/access.log | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "=== ERROS 4xx/5xx (última hora) ===" | tee -a "$LOG_FILE"
sudo awk -v d="$(date -u -d '1 hour ago' '+%d/%b/%Y:%H')" '$4 ~ d && ($9 ~ /^4/ || $9 ~ /^5/)' /var/log/nginx/access.log | tail -n 50 | tee -a "$LOG_FILE" || echo "Nenhum erro encontrado" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 9. DIRETÓRIO DO PROJETO
echo "📁 9. ESTRUTURA DO PROJETO" | tee -a "$LOG_FILE"
echo "---------------------------" | tee -a "$LOG_FILE"
echo "Conteúdo de ${PROJECT_DIR}:" | tee -a "$LOG_FILE"
ls -la "${PROJECT_DIR}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Estrutura da API:" | tee -a "$LOG_FILE"
ls -la "${PROJECT_DIR}/api/" 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Handlers de autenticação:" | tee -a "$LOG_FILE"
ls -la "${PROJECT_DIR}/api/ifood-auth/" 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 10. ARQUIVO .env
echo "🔐 10. VARIÁVEIS DE AMBIENTE" | tee -a "$LOG_FILE"
echo "-----------------------------" | tee -a "$LOG_FILE"
if [ -f "${PROJECT_DIR}/.env" ]; then
    echo "✅ .env existe" | tee -a "$LOG_FILE"
    echo "Variáveis configuradas (sem valores sensíveis):" | tee -a "$LOG_FILE"
    grep -v "^#" "${PROJECT_DIR}/.env" | grep -v "^$" | cut -d'=' -f1 | tee -a "$LOG_FILE"
else
    echo "❌ .env NÃO EXISTE" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 11. DEPENDÊNCIAS
echo "📦 11. DEPENDÊNCIAS NODE.JS" | tee -a "$LOG_FILE"
echo "----------------------------" | tee -a "$LOG_FILE"
cd "${PROJECT_DIR}"
echo "Node version: $(node -v)" | tee -a "$LOG_FILE"
echo "NPM version: $(npm -v)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
if [ -d "node_modules" ]; then
    echo "✅ node_modules existe ($(du -sh node_modules 2>/dev/null | cut -f1))" | tee -a "$LOG_FILE"
    echo "Pacotes principais instalados:" | tee -a "$LOG_FILE"
    ls node_modules/ | grep -E "@supabase|express|cors|dotenv|@vercel" | tee -a "$LOG_FILE"
else
    echo "❌ node_modules NÃO EXISTE" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 12. TESTES DE CONECTIVIDADE
echo "🧪 12. TESTES DE CONECTIVIDADE" | tee -a "$LOG_FILE"
echo "--------------------------------" | tee -a "$LOG_FILE"
echo "=== Teste 1: Health check local (localhost:3000) ===" | tee -a "$LOG_FILE"
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" http://localhost:3000/api/ifood-auth/health 2>&1 | tee -a "$LOG_FILE" || echo "❌ Falhou" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "=== Teste 2: Health check via domínio (api.usa-dex.com.br) ===" | tee -a "$LOG_FILE"
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" https://api.usa-dex.com.br/api/ifood-auth/health 2>&1 | tee -a "$LOG_FILE" || echo "❌ Falhou" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "=== Teste 3: CORS Headers ===" | tee -a "$LOG_FILE"
curl -I -X OPTIONS https://api.usa-dex.com.br/api/ifood-auth/health \
  -H "Origin: https://dex-parceiros-api-ifood-nxij.vercel.app" \
  -H "Access-Control-Request-Method: POST" 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

echo "=== Teste 4: DNS resolution ===" | tee -a "$LOG_FILE"
nslookup api.usa-dex.com.br 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 13. RESUMO E PROBLEMAS
echo "📊 13. RESUMO DO DIAGNÓSTICO" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

ISSUES=0
WARNINGS=0

# Verificar problemas críticos
if ! pm2 describe dex-api &> /dev/null; then
    echo "❌ CRÍTICO: Processo dex-api não está rodando" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if ! sudo lsof -i :3000 &> /dev/null; then
    echo "❌ CRÍTICO: Porta 3000 não está em uso" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if ! sudo nginx -t &> /dev/null; then
    echo "❌ CRÍTICO: Configuração do Nginx inválida" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if [ ! -f "${PROJECT_DIR}/.env" ]; then
    echo "❌ CRÍTICO: Arquivo .env não existe" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
    echo "❌ CRÍTICO: node_modules não existe" | tee -a "$LOG_FILE"
    ISSUES=$((ISSUES + 1))
fi

# Verificar avisos
if ! sudo grep -r "Access-Control-Allow" /etc/nginx/sites-enabled/ &> /dev/null; then
    echo "⚠️  AVISO: CORS não configurado no Nginx" | tee -a "$LOG_FILE"
    WARNINGS=$((WARNINGS + 1))
fi

if ! curl -s http://localhost:3000/api/ifood-auth/health | grep -q "healthy"; then
    echo "⚠️  AVISO: Health check não retorna 'healthy'" | tee -a "$LOG_FILE"
    WARNINGS=$((WARNINGS + 1))
fi

echo "" | tee -a "$LOG_FILE"
if [ $ISSUES -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ Nenhum problema detectado!" | tee -a "$LOG_FILE"
elif [ $ISSUES -eq 0 ]; then
    echo "⚠️  $WARNINGS aviso(s) encontrado(s)" | tee -a "$LOG_FILE"
else
    echo "❌ $ISSUES problema(s) crítico(s) e $WARNINGS aviso(s)" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "✅ Diagnóstico completo!" | tee -a "$LOG_FILE"
echo "📄 Log salvo em: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Para visualizar:" | tee -a "$LOG_FILE"
echo "  cat $LOG_FILE" | tee -a "$LOG_FILE"
echo "  less $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Para copiar para sua máquina local:" | tee -a "$LOG_FILE"
echo "  scp root@89.116.29.187:$LOG_FILE ./" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
