# ⏰ Configuração do Cron de Renovação de Tokens

## 📋 Pré-requisitos

1. API rodando no Contabo
2. Variável `CRON_SECRET` configurada no `.env`
3. Variável `BASE_URL` configurada (opcional, padrão: http://localhost:3000)

---

## 🚀 Instalação

### **Método 1: Cron do Sistema (Recomendado)**

#### 1. Dar permissão ao script
```bash
chmod +x /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

#### 2. Criar diretório de logs
```bash
mkdir -p /home/dex/logs
```

#### 3. Adicionar ao crontab
```bash
crontab -e
```

#### 4. Adicionar linha (executa a cada 30 minutos)
```cron
*/30 * * * * /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

#### 5. Verificar instalação
```bash
# Listar cron jobs
crontab -l

# Testar script manualmente
/home/dex/dex-app/scripts/refresh-tokens-cron.sh

# Ver logs
tail -f /home/dex/logs/cron-refresh-tokens.log
```

---

### **Método 2: PM2 com Cron**

#### 1. Instalar módulo PM2 cron
```bash
pm2 install pm2-cron
```

#### 2. Usar ecosystem.config.js
```bash
cd /home/dex/dex-app
pm2 start ecosystem.config.js
```

#### 3. Verificar status
```bash
pm2 status
pm2 logs dex-cron-refresh
```

---

## 🧪 Teste Manual

### Testar endpoint diretamente
```bash
curl -X POST http://localhost:3000/api/cron/refresh-tokens \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Resposta esperada
```json
{
  "message": "Token refresh completed",
  "processed": 2,
  "success": 2,
  "failures": 0,
  "results": [...]
}
```

---

## 📊 Monitoramento

### Ver logs do cron
```bash
tail -f /home/dex/logs/cron-refresh-tokens.log
```

### Verificar tokens no Supabase
```sql
-- Tokens expirando em breve
SELECT 
  account_id, 
  scope, 
  expires_at,
  expires_at - NOW() as tempo_restante
FROM ifood_store_auth
WHERE expires_at < NOW() + INTERVAL '1 hour'
  AND expires_at > NOW()
ORDER BY expires_at;

-- Última renovação
SELECT 
  account_id,
  scope,
  updated_at,
  expires_at
FROM ifood_store_auth
WHERE status = 'connected'
ORDER BY updated_at DESC
LIMIT 10;
```

---

## 🔧 Configuração de Frequência

### A cada 30 minutos (padrão)
```cron
*/30 * * * * /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

### A cada 1 hora
```cron
0 * * * * /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

### A cada 15 minutos (mais agressivo)
```cron
*/15 * * * * /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

### Apenas em horário comercial (8h-18h)
```cron
*/30 8-18 * * * /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

---

## ⚠️ Troubleshooting

### Cron não executa
```bash
# Verificar se cron está rodando
sudo systemctl status cron

# Ver logs do sistema
grep CRON /var/log/syslog

# Verificar permissões
ls -la /home/dex/dex-app/scripts/refresh-tokens-cron.sh
```

### Erro 401 Unauthorized
- Verificar se `CRON_SECRET` está configurado no `.env`
- Verificar se o script está carregando o `.env` corretamente

### Tokens não renovam
- Verificar logs em `/home/dex/logs/cron-refresh-tokens.log`
- Testar endpoint manualmente
- Verificar se API está rodando: `pm2 status dex-api`

---

## 🎯 Checklist de Instalação

- [ ] Script tem permissão de execução (`chmod +x`)
- [ ] Diretório de logs existe (`/home/dex/logs`)
- [ ] `CRON_SECRET` configurado no `.env`
- [ ] Cron job adicionado ao crontab
- [ ] Teste manual executado com sucesso
- [ ] Logs sendo gerados corretamente
- [ ] Notificações Discord funcionando (opcional)

---

## 📞 Suporte

Se o cron não funcionar após seguir todos os passos:

1. Verificar logs: `tail -f /home/dex/logs/cron-refresh-tokens.log`
2. Testar manualmente: `./scripts/refresh-tokens-cron.sh`
3. Verificar API: `pm2 logs dex-api`
4. Verificar Supabase: Query de tokens expirando

---

**Última atualização:** 2025-11-10
