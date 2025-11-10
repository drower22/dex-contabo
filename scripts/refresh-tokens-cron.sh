#!/bin/bash

# Script para executar refresh de tokens via cron
# Uso: ./refresh-tokens-cron.sh

# Carregar variáveis de ambiente
source /home/dex/dex-app/.env

# URL da API (local ou remota)
API_URL="${BASE_URL:-http://localhost:3000}"

# Log file
LOG_FILE="/home/dex/logs/cron-refresh-tokens.log"

# Timestamp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando refresh de tokens..." >> "$LOG_FILE"

# Executar chamada
response=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/api/cron/refresh-tokens" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

# Separar body e status code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

# Log resultado
if [ "$http_code" -eq 200 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Sucesso: $body" >> "$LOG_FILE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Erro ($http_code): $body" >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Concluído" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
