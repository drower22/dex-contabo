#!/bin/bash
# ============================================================================
# Script de Validação de Ambiente - iFood Auth
# ============================================================================
# Valida todas as variáveis de ambiente necessárias para autenticação iFood
# ============================================================================

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contadores
ERRORS=0
WARNINGS=0
SUCCESS=0

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Validação de Ambiente - Autenticação iFood               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Função para verificar variável obrigatória
check_required() {
    local var_name=$1
    local var_value="${!var_name}"
    
    if [ -z "$var_value" ]; then
        echo -e "${RED}✗${NC} $var_name: ${RED}NÃO CONFIGURADO${NC}"
        ((ERRORS++))
        return 1
    else
        echo -e "${GREEN}✓${NC} $var_name: ${GREEN}CONFIGURADO${NC}"
        ((SUCCESS++))
        return 0
    fi
}

# Função para verificar variável opcional
check_optional() {
    local var_name=$1
    local var_value="${!var_name}"
    
    if [ -z "$var_value" ]; then
        echo -e "${YELLOW}○${NC} $var_name: ${YELLOW}NÃO CONFIGURADO (opcional)${NC}"
        ((WARNINGS++))
        return 1
    else
        echo -e "${GREEN}✓${NC} $var_name: ${GREEN}CONFIGURADO${NC}"
        ((SUCCESS++))
        return 0
    fi
}

# Carregar .env se existir
if [ -f .env ]; then
    echo -e "${BLUE}📄 Carregando .env...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
    echo ""
else
    echo -e "${YELLOW}⚠️  Arquivo .env não encontrado${NC}"
    echo ""
fi

# ============================================================================
# VALIDAÇÕES OBRIGATÓRIAS
# ============================================================================

echo -e "${BLUE}═══ Variáveis Obrigatórias ═══${NC}"
echo ""

check_required "SUPABASE_URL"
check_required "SUPABASE_SERVICE_ROLE_KEY"
check_required "ENCRYPTION_KEY"

echo ""

# ============================================================================
# VALIDAÇÕES DE CREDENCIAIS IFOOD
# ============================================================================

echo -e "${BLUE}═══ Credenciais iFood ═══${NC}"
echo ""

# Verificar se tem pelo menos um conjunto de credenciais
HAS_REVIEWS=0
HAS_FINANCIAL=0
HAS_FALLBACK=0

if check_optional "IFOOD_CLIENT_ID_REVIEWS" && check_optional "IFOOD_CLIENT_SECRET_REVIEWS"; then
    HAS_REVIEWS=1
fi

echo ""

if check_optional "IFOOD_CLIENT_ID_FINANCIAL" && check_optional "IFOOD_CLIENT_SECRET_FINANCIAL"; then
    HAS_FINANCIAL=1
fi

echo ""

if check_optional "IFOOD_CLIENT_ID" && check_optional "IFOOD_CLIENT_SECRET"; then
    HAS_FALLBACK=1
fi

echo ""

# Validar se tem pelo menos um conjunto
if [ $HAS_REVIEWS -eq 0 ] && [ $HAS_FINANCIAL -eq 0 ] && [ $HAS_FALLBACK -eq 0 ]; then
    echo -e "${RED}✗ ERRO: Nenhum conjunto de credenciais iFood configurado!${NC}"
    echo -e "${YELLOW}  Configure pelo menos um dos seguintes:${NC}"
    echo -e "${YELLOW}  - IFOOD_CLIENT_ID_REVIEWS + IFOOD_CLIENT_SECRET_REVIEWS${NC}"
    echo -e "${YELLOW}  - IFOOD_CLIENT_ID_FINANCIAL + IFOOD_CLIENT_SECRET_FINANCIAL${NC}"
    echo -e "${YELLOW}  - IFOOD_CLIENT_ID + IFOOD_CLIENT_SECRET (fallback)${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓ Pelo menos um conjunto de credenciais iFood configurado${NC}"
    
    if [ $HAS_REVIEWS -eq 1 ]; then
        echo -e "${GREEN}  → Reviews: OK${NC}"
    fi
    if [ $HAS_FINANCIAL -eq 1 ]; then
        echo -e "${GREEN}  → Financial: OK${NC}"
    fi
    if [ $HAS_FALLBACK -eq 1 ]; then
        echo -e "${GREEN}  → Fallback: OK${NC}"
    fi
fi

echo ""

# ============================================================================
# VALIDAÇÕES OPCIONAIS
# ============================================================================

echo -e "${BLUE}═══ Configurações Opcionais ═══${NC}"
echo ""

check_optional "IFOOD_BASE_URL"
check_optional "CORS_ORIGIN"
check_optional "DISCORD_WEBHOOK_URL"
check_optional "CRON_SECRET"
check_optional "BASE_URL"

echo ""

# ============================================================================
# VALIDAÇÃO DA ENCRYPTION_KEY
# ============================================================================

echo -e "${BLUE}═══ Validação de ENCRYPTION_KEY ═══${NC}"
echo ""

if [ -n "$ENCRYPTION_KEY" ]; then
    # Verificar se é base64 válido
    if echo "$ENCRYPTION_KEY" | base64 -d > /dev/null 2>&1; then
        # Verificar tamanho (deve ser 32 bytes = 44 caracteres em base64)
        KEY_LENGTH=${#ENCRYPTION_KEY}
        if [ $KEY_LENGTH -ge 40 ]; then
            echo -e "${GREEN}✓ ENCRYPTION_KEY: Formato válido (base64, $KEY_LENGTH chars)${NC}"
        else
            echo -e "${YELLOW}⚠️  ENCRYPTION_KEY: Muito curta ($KEY_LENGTH chars, recomendado >= 44)${NC}"
            ((WARNINGS++))
        fi
    else
        echo -e "${RED}✗ ENCRYPTION_KEY: Formato inválido (não é base64 válido)${NC}"
        ((ERRORS++))
    fi
else
    echo -e "${RED}✗ ENCRYPTION_KEY: Não configurada${NC}"
fi

echo ""

# ============================================================================
# TESTE DE CONEXÃO SUPABASE
# ============================================================================

echo -e "${BLUE}═══ Teste de Conexão Supabase ═══${NC}"
echo ""

if [ -n "$SUPABASE_URL" ]; then
    if curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" | grep -q "200\|401"; then
        echo -e "${GREEN}✓ Supabase: Conexão OK${NC}"
    else
        echo -e "${RED}✗ Supabase: Falha na conexão${NC}"
        ((ERRORS++))
    fi
else
    echo -e "${YELLOW}○ Supabase: URL não configurada, pulando teste${NC}"
fi

echo ""

# ============================================================================
# RESUMO
# ============================================================================

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Resumo da Validação                                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✓ Sucesso:${NC}  $SUCCESS"
echo -e "  ${YELLOW}⚠ Avisos:${NC}   $WARNINGS"
echo -e "  ${RED}✗ Erros:${NC}    $ERRORS"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  VALIDAÇÃO FALHOU - Corrija os erros acima                ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 1
else
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  VALIDAÇÃO PASSOU - Ambiente configurado corretamente     ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    
    if [ $WARNINGS -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}⚠️  Existem $WARNINGS avisos. Revise as configurações opcionais.${NC}"
    fi
    
    exit 0
fi
