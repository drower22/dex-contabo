#!/bin/bash

# Script para testar endpoint de link
# Uso: ./test-link.sh

echo "🧪 Testando endpoint /api/ifood-auth/link..."
echo ""

# Teste 1: Financial scope
echo "📌 Teste 1: Gerar link code (financial)"
curl -X POST http://localhost:3000/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"financial","storeId":"7ccec898-591d-47e1-b044-2b75dd30f144"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'

echo ""
echo "---"
echo ""

# Teste 2: Reviews scope
echo "📌 Teste 2: Gerar link code (reviews)"
curl -X POST http://localhost:3000/api/ifood-auth/link \
  -H "Content-Type: application/json" \
  -d '{"scope":"reviews","storeId":"7ccec898-591d-47e1-b044-2b75dd30f144"}' \
  -w "\nHTTP Status: %{http_code}\n" \
  -s | jq '.'

echo ""
echo "✅ Testes concluídos!"
