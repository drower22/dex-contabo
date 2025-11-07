#!/bin/bash
# Script simples para encontrar o diretório do projeto no servidor

echo "🔍 PROCURANDO PROJETO DEX-CONTABO NO SERVIDOR..."
echo ""

# Possíveis localizações
POSSIBLE_DIRS=(
    "/var/www/dex-contabo"
    "/home/$(whoami)/dex-contabo"
    "/opt/dex-contabo"
    "/root/dex-contabo"
    "/var/www/html/dex-contabo"
    "/usr/local/dex-contabo"
    "$(pwd)"
    "$HOME/dex-contabo"
)

# Tentar encontrar pelo PM2
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 encontrado, verificando processos..."
    pm2 list
    echo ""
    
    PM2_DIR=$(pm2 describe dex-api 2>/dev/null | grep "script path" | awk '{print $4}' | xargs dirname 2>/dev/null || echo "")
    if [ -n "$PM2_DIR" ] && [ -d "$PM2_DIR" ]; then
        echo "✅ Projeto encontrado via PM2:"
        echo "   $PM2_DIR"
        echo ""
        ls -la "$PM2_DIR"
        exit 0
    fi
fi

echo "Procurando em localizações comuns..."
echo ""

FOUND=0
for dir in "${POSSIBLE_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        # Verificar se tem package.json
        if [ -f "$dir/package.json" ]; then
            echo "📦 Encontrado: $dir"
            echo "   package.json:"
            grep -E '"name"|"description"' "$dir/package.json" 2>/dev/null | head -2
            
            # Verificar se é o projeto correto
            if grep -q "dex-backend-contabo\|ifood-auth" "$dir/package.json" 2>/dev/null || [ -d "$dir/api/ifood-auth" ]; then
                echo "   ✅ Este parece ser o projeto correto!"
                FOUND=1
            fi
            echo ""
        fi
    fi
done

if [ $FOUND -eq 0 ]; then
    echo "❌ Projeto não encontrado automaticamente"
    echo ""
    echo "Por favor, procure manualmente:"
    echo "  find / -name 'ecosystem.config.js' 2>/dev/null"
    echo "  find /home -name 'package.json' -path '*/dex*/package.json' 2>/dev/null"
    echo ""
    echo "Ou me diga onde está o projeto!"
fi
