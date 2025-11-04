-- ============================================================================
-- Script SQL para Validação do Fluxo de Autenticação iFood
-- ============================================================================
-- Uso: Execute estas queries no Supabase SQL Editor para validar o estado
--      da autenticação em cada etapa do fluxo.
-- ============================================================================

-- ============================================================================
-- PREPARAÇÃO: Verificar estrutura da tabela
-- ============================================================================

-- 1. Verificar se a tabela existe e tem a estrutura correta
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'ifood_store_auth'
ORDER BY ordinal_position;

-- 2. Verificar constraints
SELECT
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'ifood_store_auth';

-- 3. Verificar índices
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ifood_store_auth';

-- ============================================================================
-- VALIDAÇÃO PRÉ-TESTE: Verificar conta
-- ============================================================================

-- 4. Verificar se a conta existe (SUBSTITUA O UUID)
SELECT 
    id,
    name,
    ifood_merchant_id,
    created_at
FROM accounts
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

-- 5. Verificar registros de autenticação existentes para a conta
SELECT 
    id,
    account_id,
    scope,
    status,
    ifood_merchant_id,
    expires_at,
    created_at,
    updated_at,
    CASE 
        WHEN access_token IS NOT NULL THEN 'SIM'
        ELSE 'NÃO'
    END as tem_access_token,
    CASE 
        WHEN refresh_token IS NOT NULL THEN 'SIM'
        ELSE 'NÃO'
    END as tem_refresh_token,
    link_code,
    CASE 
        WHEN verifier IS NOT NULL THEN 'SIM'
        ELSE 'NÃO'
    END as tem_verifier
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY scope, created_at DESC;

-- ============================================================================
-- VALIDAÇÃO PASSO 1: Após solicitar código de vínculo (link)
-- ============================================================================

-- 6. Verificar se o link_code foi salvo
SELECT 
    account_id,
    scope,
    link_code,
    CASE 
        WHEN verifier IS NOT NULL THEN 'SIM (' || length(verifier) || ' chars)'
        ELSE 'NÃO'
    END as verifier_salvo,
    status,
    created_at
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews'  -- ou 'financial'
ORDER BY created_at DESC
LIMIT 1;

-- 7. Verificar se o status está 'pending' após link
SELECT 
    COUNT(*) as total,
    status
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews'
  AND status = 'pending'
GROUP BY status;

-- ============================================================================
-- VALIDAÇÃO PASSO 2: Após trocar código por tokens (exchange)
-- ============================================================================

-- 8. Verificar se os tokens foram salvos e criptografados
SELECT 
    account_id,
    scope,
    ifood_merchant_id,
    status,
    expires_at,
    CASE 
        WHEN access_token IS NOT NULL THEN 'SIM (' || length(access_token) || ' chars)'
        ELSE 'NÃO'
    END as access_token_criptografado,
    CASE 
        WHEN refresh_token IS NOT NULL THEN 'SIM (' || length(refresh_token) || ' chars)'
        ELSE 'NÃO'
    END as refresh_token_criptografado,
    CASE 
        WHEN expires_at > NOW() THEN 'VÁLIDO (expira em ' || EXTRACT(EPOCH FROM (expires_at - NOW()))/60 || ' min)'
        ELSE 'EXPIRADO'
    END as status_expiracao,
    updated_at
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews'
ORDER BY updated_at DESC
LIMIT 1;

-- 9. Verificar se o merchantId foi atualizado na tabela accounts
SELECT 
    a.id,
    a.name,
    a.ifood_merchant_id,
    isa.ifood_merchant_id as merchant_id_na_auth,
    CASE 
        WHEN a.ifood_merchant_id = isa.ifood_merchant_id THEN 'SINCRONIZADO'
        ELSE 'DESSINCRONIZADO'
    END as status_sincronizacao
FROM accounts a
LEFT JOIN ifood_store_auth isa ON isa.account_id = a.id AND isa.scope = 'reviews'
WHERE a.id = '550e8400-e29b-41d4-a716-446655440000';

-- 10. Verificar se o status mudou para 'connected'
SELECT 
    account_id,
    scope,
    status,
    updated_at
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews'
  AND status = 'connected';

-- ============================================================================
-- VALIDAÇÃO PASSO 3: Após validar status
-- ============================================================================

-- 11. Verificar último status conhecido
SELECT 
    account_id,
    scope,
    status,
    ifood_merchant_id,
    CASE 
        WHEN expires_at > NOW() THEN 'Token válido por mais ' || ROUND(EXTRACT(EPOCH FROM (expires_at - NOW()))/60) || ' minutos'
        WHEN expires_at IS NULL THEN 'Sem token'
        ELSE 'Token expirado há ' || ROUND(EXTRACT(EPOCH FROM (NOW() - expires_at))/60) || ' minutos'
    END as info_expiracao,
    updated_at as ultima_atualizacao
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';

-- ============================================================================
-- VALIDAÇÃO PASSO 4: Após refresh de token
-- ============================================================================

-- 12. Verificar se expires_at foi atualizado (indica refresh bem-sucedido)
SELECT 
    account_id,
    scope,
    expires_at,
    updated_at,
    EXTRACT(EPOCH FROM (expires_at - updated_at))/60 as minutos_de_validade,
    CASE 
        WHEN updated_at > NOW() - INTERVAL '5 minutes' THEN 'RECENTE (últimos 5 min)'
        ELSE 'ANTIGO'
    END as recencia_atualizacao
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews'
ORDER BY updated_at DESC
LIMIT 1;

-- ============================================================================
-- QUERIES DE DIAGNÓSTICO
-- ============================================================================

-- 13. Resumo geral de todas as autenticações da conta
SELECT 
    scope,
    status,
    ifood_merchant_id,
    CASE 
        WHEN expires_at > NOW() THEN '✓ Válido'
        WHEN expires_at IS NULL THEN '⚠ Sem token'
        ELSE '✗ Expirado'
    END as status_token,
    CASE 
        WHEN access_token IS NOT NULL AND refresh_token IS NOT NULL THEN '✓ Completo'
        WHEN access_token IS NOT NULL THEN '⚠ Só access'
        WHEN refresh_token IS NOT NULL THEN '⚠ Só refresh'
        ELSE '✗ Sem tokens'
    END as tokens_disponiveis,
    created_at,
    updated_at
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY scope, created_at DESC;

-- 14. Histórico de atualizações (últimas 10)
SELECT 
    scope,
    status,
    CASE 
        WHEN expires_at > NOW() THEN 'Válido'
        WHEN expires_at IS NULL THEN 'Sem token'
        ELSE 'Expirado'
    END as status_token,
    updated_at,
    EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutos_atras
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY updated_at DESC
LIMIT 10;

-- 15. Verificar se há múltiplos registros para o mesmo scope (não deveria haver)
SELECT 
    account_id,
    scope,
    COUNT(*) as quantidade,
    CASE 
        WHEN COUNT(*) > 1 THEN '⚠ PROBLEMA: Múltiplos registros'
        ELSE '✓ OK'
    END as status
FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY account_id, scope;

-- ============================================================================
-- TESTES DE CENÁRIOS DE ERRO
-- ============================================================================

-- 16. Simular token expirado (USE COM CUIDADO - ALTERA DADOS)
-- DESCOMENTE APENAS SE QUISER TESTAR CENÁRIO DE EXPIRAÇÃO
/*
UPDATE ifood_store_auth
SET expires_at = NOW() - INTERVAL '1 hour',
    updated_at = NOW()
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';
*/

-- 17. Verificar tokens que estão prestes a expirar (< 10 minutos)
SELECT 
    account_id,
    scope,
    ifood_merchant_id,
    expires_at,
    ROUND(EXTRACT(EPOCH FROM (expires_at - NOW()))/60) as minutos_restantes,
    '⚠ ATENÇÃO: Token expira em breve' as alerta
FROM ifood_store_auth
WHERE expires_at IS NOT NULL
  AND expires_at > NOW()
  AND expires_at < NOW() + INTERVAL '10 minutes'
ORDER BY expires_at ASC;

-- 18. Listar todos os tokens expirados
SELECT 
    account_id,
    scope,
    status,
    expires_at,
    ROUND(EXTRACT(EPOCH FROM (NOW() - expires_at))/60) as minutos_expirado,
    updated_at
FROM ifood_store_auth
WHERE expires_at IS NOT NULL
  AND expires_at < NOW()
ORDER BY expires_at DESC;

-- ============================================================================
-- LIMPEZA (USE COM EXTREMO CUIDADO)
-- ============================================================================

-- 19. Remover registros de autenticação de uma conta específica
-- DESCOMENTE APENAS SE QUISER RESETAR COMPLETAMENTE A AUTENTICAÇÃO
/*
DELETE FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000';
*/

-- 20. Resetar apenas um escopo específico
-- DESCOMENTE APENAS SE QUISER RESETAR UM ESCOPO
/*
DELETE FROM ifood_store_auth
WHERE account_id = '550e8400-e29b-41d4-a716-446655440000'
  AND scope = 'reviews';
*/

-- ============================================================================
-- ESTATÍSTICAS GERAIS (TODAS AS CONTAS)
-- ============================================================================

-- 21. Resumo de autenticações por status
SELECT 
    status,
    scope,
    COUNT(*) as quantidade,
    COUNT(DISTINCT account_id) as contas_unicas
FROM ifood_store_auth
GROUP BY status, scope
ORDER BY scope, status;

-- 22. Autenticações por scope
SELECT 
    scope,
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'connected' THEN 1 END) as conectadas,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendentes,
    COUNT(CASE WHEN status = 'error' THEN 1 END) as com_erro,
    COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as tokens_validos,
    COUNT(CASE WHEN expires_at < NOW() THEN 1 END) as tokens_expirados
FROM ifood_store_auth
GROUP BY scope;

-- 23. Últimas 20 autenticações criadas
SELECT 
    account_id,
    scope,
    status,
    ifood_merchant_id,
    created_at,
    EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as horas_atras
FROM ifood_store_auth
ORDER BY created_at DESC
LIMIT 20;

-- 24. Contas com autenticação em ambos os escopos
SELECT 
    a.id,
    a.name,
    a.ifood_merchant_id,
    COUNT(DISTINCT isa.scope) as escopos_autenticados,
    STRING_AGG(DISTINCT isa.scope, ', ') as escopos,
    STRING_AGG(DISTINCT isa.status, ', ') as status_por_escopo
FROM accounts a
INNER JOIN ifood_store_auth isa ON isa.account_id = a.id
GROUP BY a.id, a.name, a.ifood_merchant_id
HAVING COUNT(DISTINCT isa.scope) = 2
ORDER BY a.name;

-- ============================================================================
-- FIM DO SCRIPT
-- ============================================================================
