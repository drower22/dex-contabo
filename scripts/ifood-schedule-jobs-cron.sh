#!/bin/bash

# Script para agendar jobs diários de conciliação iFood via cron
# Uso: ./ifood-schedule-jobs-cron.sh

# Carregar variáveis de ambiente
source /home/dex/dex-app/.env

# URL da API (local ou remota)
API_URL="${BASE_URL:-http://localhost:3000}"

# Log file
LOG_FILE="/home/dex/logs/cron-ifood-schedule-jobs.log"

# Timestamp inicial
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando agendamento de jobs de conciliação iFood..." >> "$LOG_FILE"

# Executar chamada (sem body; competência é inferida no backend)
response=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/api/cron/ifood-schedule-jobs" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}')

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
