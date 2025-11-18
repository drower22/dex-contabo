# 🧟 Como Matar Processos Zumbis na Porta 3000

## Problema

Processos `node` ou `tsx` ficam rodando na porta 3000 mesmo depois de parar o PM2, impedindo que o servidor suba.

## Solução Rápida (Copy & Paste)

```bash
# 1. Parar PM2 do root
pm2 stop dex-api
pm2 delete dex-api

# 2. Parar PM2 do usuário dex
sudo -u dex pm2 stop all
sudo -u dex pm2 delete all

# 3. Matar todos os processos node
sudo killall -9 node
sudo killall -9 tsx

# 4. Verificar se a porta 3000 está livre
sudo lsof -i :3000 -nP

# 5. Se ainda aparecer algo, matar manualmente
sudo lsof -i :3000 -nP | grep LISTEN | awk '{print $2}' | xargs -r sudo kill -9

# 6. Confirmar que liberou
sudo lsof -i :3000 -nP

# 7. Subir o PM2 novamente
pm2 start ecosystem.config.js

# 8. Verificar se está rodando
pm2 logs dex-api --lines 20
```

## Diagnóstico Detalhado

### Ver quem está usando a porta 3000

```bash
sudo lsof -i :3000 -nP
```

Saída esperada quando a porta está ocupada:
```
COMMAND     PID USER   FD   TYPE     DEVICE SIZE/OFF NODE NAME
node    1234567  dex   28u  IPv6 2707531389      0t0  TCP *:3000 (LISTEN)
```

### Ver todos os processos node rodando

```bash
ps aux | grep node
```

### Ver PM2 de todos os usuários

```bash
# PM2 do root
pm2 list

# PM2 do usuário dex
sudo -u dex pm2 list
```

## Prevenção

### Sempre usar o mesmo usuário para PM2

Escolha **UM** usuário (recomendado: `root`) e sempre use ele:

```bash
# Sempre como root
pm2 list
pm2 start ecosystem.config.js
pm2 restart dex-api
```

### Script de limpeza antes de deploy

Crie `/home/dex/dex-app/cleanup.sh`:

```bash
#!/bin/bash
echo "🧹 Limpando processos antigos..."

# Parar PM2 de todos os usuários
sudo -u dex pm2 delete all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Matar processos node/tsx na porta 3000
sudo lsof -i :3000 -nP | grep LISTEN | awk '{print $2}' | xargs -r sudo kill -9

echo "✅ Limpeza concluída"
```

Uso:

```bash
bash /home/dex/dex-app/cleanup.sh
pm2 start ecosystem.config.js
```

## Causas Comuns

1. **PM2 rodando como usuários diferentes** (root e dex)
2. **Processos não gerenciados pelo PM2** (tsx, node direto)
3. **PM2 não matando processos filhos** ao fazer stop/delete
4. **Múltiplas tentativas de restart** criando processos órfãos

## Verificação Final

Depois de limpar e subir, confirme:

```bash
# Deve mostrar apenas 1 processo dex-api
pm2 list

# Deve mostrar o servidor rodando na porta 3000
sudo lsof -i :3000 -nP

# Deve mostrar logs do servidor funcionando
pm2 logs dex-api --lines 20
```

Procure por:
```
✅ Sales handler loaded
🚀 Dex Contabo API (TypeScript) running on http://localhost:3000
```
