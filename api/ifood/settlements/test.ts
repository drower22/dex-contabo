/**
 * @file dex-contabo/api/ifood/settlements/test.ts
 * @description Endpoint de TESTE para explorar a API de Settlements do iFood
 * 
 * OBJETIVO: Descobrir a estrutura real da API antes de criar o schema do banco
 * 
 * NÃO SALVA DADOS - apenas retorna a resposta da API para análise
 * 
 * ESTRUTURA ESPERADA (baseada na documentação oficial):
 * {
 *   "beginDate": "2024-07-01",
 *   "endDate": "2024-07-07",
 *   "balance": 34069.17,
 *   "merchantId": "b00ff000-0a0d-0c00-a0c0-b0f00000e000",
 *   "settlements": [
 *     {
 *       "startDateCalculation": "2024-07-01",
 *       "endDateCalculation": "2024-07-07",
 *       "closingItems": [
 *         {
 *           "id": "110825091",
 *           "type": "RENEGOCIADA" | "REPASSE" | "REGISTRO_RECEBIVEIS",
 *           "product": "IFOOD",
 *           "amount": 84640.09,
 *           "status": "TRANSFER_RENEGOTIATED" | "SUCCEED",
 *           "transactionId": "7d05deb7-b12a-4226-b4d6-cd3b0b682ca8",
 *           "accountDetails": {
 *             "bankName": "BANCO XPTO S.A.",
 *             "bankNumber": "022",
 *             "branchCode": "0001",
 *             "accountNumber": "44416444",
 *             "accountDigit": "4",
 *             "documentNumber": "24222444222444"
 *           },
 *           "paymentDate": "2024-07-10"
 *         }
 *       ]
 *     }
 *   ]
 * }
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-settlement/
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { merchantId, accountId, startDate, endDate } = req.body;

    if (!merchantId || !accountId || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'merchantId, accountId, startDate, and endDate are required',
        trace_id: traceId
      });
    }

    console.log(`[settlements-test] 🧪 TESTE - Explorando API de Settlements`, {
      trace_id: traceId,
      merchant_id: merchantId,
      date_range: { startDate, endDate }
    });

    // 1. Buscar token OAuth
    const { data: authData, error: authError } = await supabase
      .from('ifood_oauth_tokens')
      .select('access_token, scope')
      .eq('account_id', accountId)
      .eq('merchant_id', merchantId)
      .eq('scope', 'financial')
      .single();

    if (authError || !authData?.access_token) {
      console.error('[settlements-test] ❌ Token não encontrado', { 
        trace_id: traceId,
        error: authError?.message 
      });
      
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Token OAuth não encontrado. Autentique com o iFood primeiro (scope: financial)',
        hint: 'Vá em Configurações > Integrações > iFood e autentique com escopo "financial"',
        trace_id: traceId
      });
    }

    console.log('[settlements-test] ✅ Token encontrado, scope:', authData.scope);

    // 2. Testar endpoint oficial da documentação
    // Ref: https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-settlement/
    const endpointsToTest = [
      {
        name: 'Settlements (Oficial)',
        url: '/financial/v1.0/settlements',
        params: { 
          merchantId, 
          beginDate: startDate,  // API usa beginDate/endDate
          endDate: endDate
        }
      },
      {
        name: 'Payouts Unified (Alternativo)',
        url: '/financial/v1.0/payouts-unified',
        params: { merchantId, startDate, endDate }
      }
    ];

    const results: any[] = [];

    for (const endpoint of endpointsToTest) {
      try {
        console.log(`[settlements-test] 🔍 Testando: ${endpoint.name} - ${endpoint.url}`);
        
        const fullUrl = `${IFOOD_BASE_URL}${endpoint.url}`;
        let apiResponse;

        if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
          console.log('[settlements-test] Usando proxy...');
          apiResponse = await axios.get(`${IFOOD_PROXY_BASE}${endpoint.url}`, {
            params: endpoint.params,
            headers: {
              'X-Shared-Key': IFOOD_PROXY_KEY,
              'X-Original-Authorization': `Bearer ${authData.access_token}`
            },
            timeout: 30000
          });
        } else {
          console.log('[settlements-test] Chamada direta...');
          apiResponse = await axios.get(fullUrl, {
            params: endpoint.params,
            headers: {
              'Authorization': `Bearer ${authData.access_token}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          });
        }

        const data = apiResponse.data?.data || apiResponse.data || [];
        
        console.log(`[settlements-test] ✅ ${endpoint.name}: ${Array.isArray(data) ? data.length : 'N/A'} registros`);

        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          fullUrl,
          params: endpoint.params,
          status: 'success',
          statusCode: apiResponse.status,
          recordCount: Array.isArray(data) ? data.length : null,
          data: data,
          headers: apiResponse.headers,
          sampleRecord: Array.isArray(data) && data.length > 0 ? data[0] : null,
          fields: Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : []
        });

      } catch (error: any) {
        console.error(`[settlements-test] ❌ ${endpoint.name} falhou:`, error.message);
        
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          params: endpoint.params,
          status: 'error',
          statusCode: error.response?.status,
          error: error.message,
          errorDetails: error.response?.data,
          hint: error.response?.status === 404 
            ? 'Endpoint não existe ou não está disponível'
            : error.response?.status === 401
            ? 'Token inválido ou sem permissão'
            : error.response?.status === 403
            ? 'Acesso negado - verifique escopo do token'
            : 'Erro desconhecido'
        });
      }
    }

    // 3. Retornar análise completa
    const successfulEndpoints = results.filter(r => r.status === 'success');
    const bestEndpoint = successfulEndpoints.find(r => r.recordCount && r.recordCount > 0) || successfulEndpoints[0];

    console.log(`[settlements-test] 📊 Resumo: ${successfulEndpoints.length}/${results.length} endpoints funcionaram`);

    return res.status(200).json({
      success: true,
      message: 'Teste de API de Settlements concluído',
      trace_id: traceId,
      summary: {
        totalEndpointsTested: results.length,
        successfulEndpoints: successfulEndpoints.length,
        failedEndpoints: results.length - successfulEndpoints.length,
        recommendedEndpoint: bestEndpoint?.endpoint || null,
        totalRecordsFound: successfulEndpoints.reduce((sum, r) => sum + (r.recordCount || 0), 0)
      },
      results: results,
      bestResult: bestEndpoint || null,
      recommendation: bestEndpoint 
        ? `✅ Use o endpoint "${bestEndpoint.endpoint}" (${bestEndpoint.url}) - encontrou ${bestEndpoint.recordCount} registros`
        : '⚠️ Nenhum endpoint retornou dados. Verifique período ou autenticação.',
      nextSteps: [
        '1. Analise a estrutura dos campos retornados (bestResult.fields)',
        '2. Verifique os dados de exemplo (bestResult.sampleRecord)',
        '3. Ajuste o schema SQL baseado nos campos reais',
        '4. Implemente o endpoint de sync definitivo'
      ]
    });

  } catch (error: any) {
    console.error('[settlements-test] 💥 Erro inesperado:', error);

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      trace_id: traceId
    });
  }
}
