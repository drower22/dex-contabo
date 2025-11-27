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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE || 'https://proxy.usa-dex.com.br/api/ifood-proxy';
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Obter token do iFood via Edge Function (mesmo padrão do sales)
 */
async function getIfoodToken(accountId: string): Promise<string> {
  console.log('🔑 [settlements-test] Obtendo token para accountId:', accountId);
  
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'financial' }
  });

  if (error || !data?.access_token) {
    console.error('❌ [settlements-test] Erro ao obter token:', error);
    throw new Error('Erro ao obter token do iFood');
  }

  console.log('✅ [settlements-test] Token obtido com sucesso');
  return data.access_token;
}

export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

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

    // 1. Buscar token via Edge Function (mesmo padrão do sales)
    let token: string;
    try {
      token = await getIfoodToken(accountId);
    } catch (error: any) {
      console.error('[settlements-test] ❌ Erro ao obter token', { 
        trace_id: traceId,
        error: error.message 
      });
      
      return res.status(401).json({
        error: 'OAuth token not found',
        message: 'Token OAuth não encontrado. Autentique com o iFood primeiro (scope: financial)',
        hint: 'Vá em Configurações > Integrações > iFood e autentique com escopo "financial"',
        trace_id: traceId
      });
    }

    console.log('[settlements-test] ✅ Token obtido com sucesso');

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
        
        // Construir query string
        const queryParams = new URLSearchParams(endpoint.params as any).toString();
        const path = `${endpoint.url}?${queryParams}`;
        const proxyUrl = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;
        
        console.log(`[settlements-test] URL proxy:`, proxyUrl);
        console.log(`[settlements-test] Path iFood:`, path);

        // Usar fetch com proxy (mesmo padrão do sales)
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'x-shared-key': IFOOD_PROXY_KEY!,
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });

        console.log(`[settlements-test] Response status:`, response.status, response.statusText);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[settlements-test] ❌ ${endpoint.name} falhou:`, errorText);
          
          results.push({
            endpoint: endpoint.name,
            url: endpoint.url,
            params: endpoint.params,
            status: 'error',
            statusCode: response.status,
            error: errorText,
            hint: response.status === 404 
              ? 'Endpoint não existe ou não está disponível'
              : response.status === 401
              ? 'Token inválido ou sem permissão'
              : response.status === 403
              ? 'Acesso negado - verifique escopo do token'
              : 'Erro desconhecido'
          });
          continue;
        }

        const data: any = await response.json();
        const settlements = data?.settlements || data?.data || data || [];
        
        console.log(`[settlements-test] ✅ ${endpoint.name}: ${Array.isArray(settlements) ? settlements.length : 'N/A'} registros`);

        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          proxyUrl,
          params: endpoint.params,
          status: 'success',
          statusCode: response.status,
          recordCount: Array.isArray(settlements) ? settlements.length : null,
          data: settlements,
          fullResponse: data,
          sampleRecord: Array.isArray(settlements) && settlements.length > 0 ? settlements[0] : null,
          fields: Array.isArray(settlements) && settlements.length > 0 ? Object.keys(settlements[0]) : []
        });

      } catch (error: any) {
        console.error(`[settlements-test] ❌ ${endpoint.name} falhou:`, error.message);
        
        results.push({
          endpoint: endpoint.name,
          url: endpoint.url,
          params: endpoint.params,
          status: 'error',
          error: error.message,
          hint: 'Erro de conexão ou timeout'
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
