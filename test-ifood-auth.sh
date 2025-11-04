#!/bin/bash
# Script de teste para validação do fluxo de autenticação iFood
# Uso: ./test-ifood-auth.sh [BASE_URL] [ACCOUNT_ID] [SCOPE]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
BASE_URL="${1:-http://localhost:8000}"
ACCOUNT_ID="${2:-550e8400-e29b-41d4-a716-446655440000}"
SCOPE="${3:-reviews}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Teste de Autenticação iFood - Fluxo Distribuído          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Configuração:${NC}"
echo -e "  Base URL: ${BASE_URL}"
echo -e "  Account ID: ${ACCOUNT_ID}"
echo -e "  Scope: ${SCOPE}"
echo ""

# Função para fazer requisições e mostrar resultado
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}${description}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    if [ "$method" = "GET" ]; then
        echo -e "${BLUE}Request:${NC} GET ${endpoint}"
        response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${endpoint}")
    else
        echo -e "${BLUE}Request:${NC} POST ${endpoint}"
        echo -e "${BLUE}Body:${NC}"
        echo "$data" | jq '.' 2>/dev/null || echo "$data"
        response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${endpoint}" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    echo ""
    echo -e "${BLUE}Response [${http_code}]:${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    echo ""
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ Sucesso${NC}"
    else
        echo -e "${RED}✗ Erro (HTTP ${http_code})${NC}"
    fi
    echo ""
    
    # Retorna o body para uso posterior
    echo "$body"
}

# Passo 1: Solicitar código de vínculo
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  PASSO 1: Solicitar Código de Vínculo (userCode)         ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

link_data=$(cat <<EOF
{
  "scope": "${SCOPE}",
  "storeId": "${ACCOUNT_ID}"
}
EOF
)

link_response=$(make_request "POST" "/api/ifood-auth/link" "$link_data" "Solicitando código de vínculo...")

# Extrai userCode e verifier
user_code=$(echo "$link_response" | jq -r '.userCode // empty')
verifier=$(echo "$link_response" | jq -r '.authorizationCodeVerifier // empty')
verification_url=$(echo "$link_response" | jq -r '.verificationUrl // empty')

if [ -n "$user_code" ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  AÇÃO NECESSÁRIA: Autorizar no Portal do Parceiro         ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}1.${NC} Acesse: ${BLUE}${verification_url}${NC}"
    echo -e "${YELLOW}2.${NC} Faça login como proprietário da loja"
    echo -e "${YELLOW}3.${NC} Digite o código: ${GREEN}${user_code}${NC}"
    echo -e "${YELLOW}4.${NC} Autorize o acesso"
    echo -e "${YELLOW}5.${NC} Copie o código de autorização fornecido"
    echo ""
    read -p "Cole o código de autorização aqui: " auth_code
    echo ""
    
    # Passo 2: Trocar código por tokens
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  PASSO 2: Trocar Código por Tokens                        ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    exchange_data=$(cat <<EOF
{
  "scope": "${SCOPE}",
  "storeId": "${ACCOUNT_ID}",
  "authorizationCode": "${auth_code}",
  "authorizationCodeVerifier": "${verifier}"
}
EOF
)
    
    exchange_response=$(make_request "POST" "/api/ifood-auth/exchange" "$exchange_data" "Trocando código por tokens...")
    
    access_token=$(echo "$exchange_response" | jq -r '.access_token // empty')
    
    if [ -n "$access_token" ]; then
        echo -e "${GREEN}✓ Tokens obtidos com sucesso!${NC}"
        echo ""
        
        # Passo 3: Validar status
        echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  PASSO 3: Validar Status da Autenticação                  ${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo ""
        
        status_response=$(make_request "GET" "/api/ifood-auth/status?accountId=${ACCOUNT_ID}&scope=${SCOPE}" "" "Validando status...")
        
        status=$(echo "$status_response" | jq -r '.status // empty')
        
        if [ "$status" = "connected" ]; then
            echo -e "${GREEN}✓ Autenticação validada com sucesso!${NC}"
            echo ""
            
            # Passo 4: Testar refresh
            echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
            echo -e "${GREEN}  PASSO 4: Testar Renovação de Token (Refresh)             ${NC}"
            echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
            echo ""
            
            merchant_id=$(echo "$status_response" | jq -r '.merchantId // empty')
            
            refresh_data=$(cat <<EOF
{
  "scope": "${SCOPE}",
  "storeId": "${merchant_id}"
}
EOF
)
            
            refresh_response=$(make_request "POST" "/api/ifood-auth/refresh" "$refresh_data" "Renovando token...")
            
            new_access_token=$(echo "$refresh_response" | jq -r '.access_token // empty')
            
            if [ -n "$new_access_token" ]; then
                echo -e "${GREEN}✓ Token renovado com sucesso!${NC}"
                echo ""
                
                # Resumo final
                echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
                echo -e "${GREEN}║  RESUMO DO TESTE - TODOS OS PASSOS CONCLUÍDOS             ║${NC}"
                echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
                echo ""
                echo -e "${GREEN}✓${NC} Passo 1: Código de vínculo obtido"
                echo -e "${GREEN}✓${NC} Passo 2: Tokens obtidos e salvos"
                echo -e "${GREEN}✓${NC} Passo 3: Status validado (connected)"
                echo -e "${GREEN}✓${NC} Passo 4: Token renovado com sucesso"
                echo ""
                echo -e "${BLUE}Merchant ID:${NC} ${merchant_id}"
                echo -e "${BLUE}Scope:${NC} ${SCOPE}"
                echo -e "${BLUE}Account ID:${NC} ${ACCOUNT_ID}"
                echo ""
                echo -e "${GREEN}🎉 Fluxo de autenticação iFood validado com sucesso!${NC}"
            else
                echo -e "${RED}✗ Falha ao renovar token${NC}"
            fi
        else
            echo -e "${RED}✗ Status não é 'connected': ${status}${NC}"
        fi
    else
        echo -e "${RED}✗ Falha ao obter tokens${NC}"
    fi
else
    echo -e "${RED}✗ Falha ao obter código de vínculo${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Teste finalizado em $(date)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
