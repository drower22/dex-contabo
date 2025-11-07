#!/bin/bash
# Script para migrar de TypeScript para JavaScript puro
# Execute no servidor: bash MIGRATE_TO_JS.sh

PROJECT_DIR="/home/dex/dex-app"
cd "$PROJECT_DIR"

echo "🔄 MIGRAÇÃO: TypeScript → JavaScript"
echo "====================================="
echo ""

# Backup
echo "1️⃣  Criando backup..."
BACKUP_DIR="backup_ts_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r api "$BACKUP_DIR/"
cp ecosystem.config.js "$BACKUP_DIR/"
echo "✅ Backup criado em: $BACKUP_DIR"
echo ""

# Verificar se arquivos JS já existem
echo "2️⃣  Verificando arquivos JavaScript..."
JS_FILES=$(find api/ifood-auth -name "*.js" | wc -l)
echo "   Encontrados $JS_FILES arquivos .js"
echo ""

# Criar novo ecosystem.config.js para JavaScript
echo "3️⃣  Criando novo ecosystem.config.js..."
cat > ecosystem.config.js << 'EOF'
// PM2 Ecosystem Config para Contabo - JavaScript Puro
module.exports = {
  apps: [
    {
      name: 'dex-api',
      script: './api/server-node.js',  // Usar versão JavaScript
      interpreter: 'node',              // Node puro, sem ts-node
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000,
    },
  ],
};
EOF
echo "✅ ecosystem.config.js atualizado"
echo ""

# Criar discord.js se não existir
echo "4️⃣  Criando discord.js..."
if [ ! -f "api/_shared/discord.js" ]; then
cat > api/_shared/discord.js << 'EOF'
/**
 * @file api/_shared/discord.js
 * @description Cliente Discord para alertas e notificações
 * Versão JavaScript puro
 */

class DiscordNotifier {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    this.enabled = !!this.webhookUrl;
  }

  async sendMessage(message) {
    if (!this.enabled || !this.webhookUrl) {
      console.log('[Discord] Webhook não configurado. Mensagem não enviada.');
      return false;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (response.status === 204) {
        return true;
      } else {
        const text = await response.text();
        console.error(`[Discord] Erro ao enviar: ${response.status} - ${text}`);
        return false;
      }
    } catch (error) {
      console.error('[Discord] Exceção ao enviar:', error);
      return false;
    }
  }

  async sendWarning(message, context, title = '⚠️ Aviso') {
    const fields = [];

    if (context) {
      for (const [key, value] of Object.entries(context)) {
        fields.push({
          name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: `\`${String(value)}\``,
          inline: true,
        });
      }
    }

    return this.sendMessage({
      embeds: [
        {
          title,
          description: message,
          color: 0xffa500, // Laranja
          fields: fields.length > 0 ? fields : undefined,
          footer: {
            text: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }
}

// Instância global
const discord = new DiscordNotifier();

// Funções de conveniência
const notifyWarning = (message, context) => discord.sendWarning(message, context);

module.exports = {
  DiscordNotifier,
  discord,
  notifyWarning
};
EOF
echo "✅ discord.js criado"
else
echo "✅ discord.js já existe"
fi
echo ""

# Parar PM2
echo "5️⃣  Parando PM2..."
pm2 delete dex-api 2>/dev/null || echo "   Nenhum processo para parar"
echo ""

# Limpar porta 3000
echo "6️⃣  Limpando porta 3000..."
sudo kill -9 $(sudo lsof -t -i:3000) 2>/dev/null || echo "   Porta já está livre"
echo ""

# Iniciar com JavaScript
echo "7️⃣  Iniciando com JavaScript puro..."
pm2 start ecosystem.config.js
pm2 save
echo ""

# Aguardar 5 segundos
echo "⏳ Aguardando 5 segundos..."
sleep 5
echo ""

# Testar
echo "8️⃣  Testando API..."
echo ""
echo "=== Health Check ==="
curl -s http://localhost:3000/api/ifood-auth/health | jq '.'
echo ""

echo "=== Status PM2 ==="
pm2 list
echo ""

echo "====================================="
echo "✅ Migração concluída!"
echo ""
echo "Verificações:"
echo "1. Health check: curl http://localhost:3000/api/ifood-auth/health | jq"
echo "2. Logs: pm2 logs dex-api"
echo "3. Status: pm2 describe dex-api"
echo ""
echo "Se algo der errado, restaure o backup:"
echo "  cp -r $BACKUP_DIR/api/* api/"
echo "  cp $BACKUP_DIR/ecosystem.config.js ."
echo "  pm2 restart dex-api"
echo "====================================="
