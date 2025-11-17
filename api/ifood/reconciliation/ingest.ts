/**
 * @file dex-contabo/api/ifood/reconciliation/ingest.ts
 * @description Handler para ingestão de relatórios de conciliação iFood
 * 
 * FLUXO:
 * 1. Recebe merchantId + competence no body
 * 2. Obtém token do header Authorization (já descriptografado pelo Supabase)
 * 3. Solicita geração do relatório (POST on-demand) - retorna requestId
 * 4. Faz polling até arquivo estar pronto (GET com requestId)
 * 5. Baixa e descompacta CSV
 * 6. Salva no Supabase Storage
 * 7. Dispara processamento Python
 * 
 * IMPORTANTE:
 * - requestId tem cache de 6 horas (409 se solicitar novamente)
 * - Competência no formato AAAA-MM
 * 
 * @see https://developer.ifood.com.br/pt-BR/docs/guides/modules/financial/api-reconciliation-ondemand/
 */

import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import * as zlib from 'zlib';

const IFOOD_BASE_URL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';
const STORAGE_BUCKET = 'conciliacao';
const MAX_POLL_ATTEMPTS = 24; // 24 tentativas x 5s = 2 minutos
const POLL_INTERVAL_MS = 5000; // 5 segundos

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Handler principal para ingestão de conciliação
 * POST /api/ingest/ifood-reconciliation
 * Body: { merchantId, competence, storeId?, triggerSource? }
 */
export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();
  
  // Criar cliente Supabase (dentro da função para garantir que env vars estejam carregadas)
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  console.log('[reconciliation-ingest] START', {
    traceId,
    method: req.method,
    body: req.body,
    hasSupabase: !!process.env.SUPABASE_URL
  });

  try {
    // 1. Validar método
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Extrair parâmetros
    const { merchantId, competence, storeId, triggerSource } = req.body;

    if (!merchantId || !competence) {
      console.error('[reconciliation-ingest] Missing parameters', { traceId, merchantId, competence });
      return res.status(400).json({
        error: 'Missing required parameters: merchantId, competence'
      });
    }

    // 3. Buscar token do Supabase (scope financial)
    console.log('[reconciliation-ingest] Fetching token from Supabase', {
      traceId,
      storeId: storeId || 'not provided'
    });

    const { data: authData, error: authError } = await supabase
      .from('ifood_store_auth')
      .select('access_token, expires_at')
      .eq('account_id', storeId || merchantId)
      .eq('scope', 'financial')
      .eq('status', 'connected')
      .maybeSingle();

    if (authError || !authData?.access_token) {
      console.error('[reconciliation-ingest] No token found', {
        traceId,
        storeId,
        merchantId,
        error: authError?.message
      });
      return res.status(401).json({
        error: 'No valid financial token found',
        details: authError?.message
      });
    }

    const token = authData.access_token;
    
    // LOG TEMPORÁRIO: Token completo para debug no API Reference
    console.log('[reconciliation-ingest] ========================================');
    console.log('[reconciliation-ingest] TOKEN COMPLETO (COPIE PARA API REFERENCE):');
    console.log(token);
    console.log('[reconciliation-ingest] ========================================');
    
    console.log('[reconciliation-ingest] Token info', {
      traceId,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...',
      tokenEnd: '...' + token.substring(token.length - 20),
      expiresAt: authData.expires_at
    });

    // 4. Solicitar geração do relatório (POST on-demand)
    const requestUrl = `${IFOOD_BASE_URL}/financial/v3/merchants/${merchantId}/reconciliation/ondemand`;
    
    console.log('[reconciliation-ingest] Requesting report generation', {
      traceId,
      url: requestUrl,
      competence,
      merchantId
    });

    const requestResponse = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ competencia: competence })
    });

    console.log('[reconciliation-ingest] iFood request response', {
      traceId,
      status: requestResponse.status,
      statusText: requestResponse.statusText,
      headers: Object.fromEntries(requestResponse.headers.entries())
    });

    if (!requestResponse.ok) {
      const errorText = await requestResponse.text();
      console.error('[reconciliation-ingest] iFood request error', {
        traceId,
        status: requestResponse.status,
        body: errorText
      });

      // 409 = já existe solicitação recente (cache de 6h)
      if (requestResponse.status === 409) {
        return res.status(409).json({
          error: 'Conflito: Já existe uma solicitação recente para esta competência (cache de 6 horas)',
          competence,
          details: errorText
        });
      }

      return res.status(requestResponse.status).json({
        error: 'iFood API error on request',
        status: requestResponse.status,
        message: errorText
      });
    }

    const requestData = await requestResponse.json() as any;
    const requestId = requestData.requestId;

    if (!requestId) {
      console.error('[reconciliation-ingest] No requestId returned', { traceId, requestData });
      return res.status(500).json({
        error: 'No requestId returned from iFood',
        data: requestData
      });
    }

    console.log('[reconciliation-ingest] Report requested successfully', {
      traceId,
      requestId,
      competence
    });

    // 5. Polling até arquivo estar pronto
    let fileUrl: string | null = null;
    let attempt = 0;

    while (attempt < MAX_POLL_ATTEMPTS && !fileUrl) {
      attempt++;
      await sleep(POLL_INTERVAL_MS);

      const pollUrl = `${IFOOD_BASE_URL}/financial/v3/merchants/${merchantId}/reconciliation/ondemand/${requestId}`;
      
      console.log('[reconciliation-ingest] Polling attempt', {
        traceId,
        attempt,
        maxAttempts: MAX_POLL_ATTEMPTS,
        pollUrl
      });

      const pollResponse = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        console.warn('[reconciliation-ingest] Poll error', {
          traceId,
          attempt,
          status: pollResponse.status,
          body: errorText
        });
        continue;
      }

      const pollData = await pollResponse.json() as any;
      console.log('[reconciliation-ingest] Poll response', {
        traceId,
        attempt,
        status: pollData.status,
        fileUrl: pollData.fileUrl
      });

      if (pollData.status === 'COMPLETED' && pollData.fileUrl) {
        fileUrl = pollData.fileUrl;
      } else if (pollData.status === 'FAILED') {
        console.error('[reconciliation-ingest] Report generation failed', { traceId, pollData });
        return res.status(500).json({
          error: 'Report generation failed',
          requestId,
          data: pollData
        });
      }
    }

    if (!fileUrl) {
      console.error('[reconciliation-ingest] Timeout waiting for file', { traceId, requestId });
      return res.status(408).json({
        error: 'Timeout waiting for report file',
        requestId,
        attempts: attempt
      });
    }

    console.log('[reconciliation-ingest] File ready', {
      traceId,
      requestId,
      fileUrl,
      attempts: attempt
    });

    // 6. Baixar arquivo
    console.log('[reconciliation-ingest] Downloading file', { traceId, fileUrl });
    
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      console.error('[reconciliation-ingest] File download error', {
        traceId,
        status: fileResponse.status
      });
      return res.status(500).json({
        error: 'Failed to download file',
        fileUrl
      });
    }

    const compressedBuffer = Buffer.from(await fileResponse.arrayBuffer());
    console.log('[reconciliation-ingest] File downloaded', {
      traceId,
      compressedSize: compressedBuffer.length
    });

    // 7. Descompactar
    const csvBuffer = await new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(compressedBuffer, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    console.log('[reconciliation-ingest] File decompressed', {
      traceId,
      decompressedSize: csvBuffer.length
    });

    // 8. Salvar no Supabase Storage
    const fileName = `${merchantId}_${competence}_${Date.now()}.csv`;
    const filePath = `reconciliation/${fileName}`;

    console.log('[reconciliation-ingest] Uploading to Supabase', {
      traceId,
      bucket: STORAGE_BUCKET,
      path: filePath
    });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, csvBuffer, {
        contentType: 'text/csv',
        upsert: false
      });

    if (uploadError) {
      console.error('[reconciliation-ingest] Upload error', {
        traceId,
        error: uploadError
      });
      return res.status(500).json({
        error: 'Failed to upload file to storage',
        details: uploadError.message
      });
    }

    console.log('[reconciliation-ingest] File uploaded successfully', {
      traceId,
      uploadData,
      filePath
    });

    // 9. Registrar na tabela received_files para processamento Python
    const { error: insertError } = await supabase
      .from('received_files')
      .insert({
        file_path: filePath,
        bucket_name: STORAGE_BUCKET,
        file_type: 'ifood_reconciliation',
        status: 'pending',
        metadata: {
          merchantId,
          competence,
          requestId,
          storeId,
          triggerSource,
          traceId
        }
      });

    if (insertError) {
      console.error('[reconciliation-ingest] Failed to register file', {
        traceId,
        error: insertError
      });
      return res.status(500).json({
        error: 'Failed to register file for processing',
        details: insertError.message
      });
    }

    console.log('[reconciliation-ingest] SUCCESS', {
      traceId,
      requestId,
      filePath,
      competence
    });

    return res.status(200).json({
      success: true,
      requestId,
      filePath,
      competence,
      traceId,
      message: 'Relatório solicitado, baixado e registrado para processamento'
    });

  } catch (error: any) {
    console.error('[reconciliation-ingest] Unexpected error', {
      traceId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      error: 'Unexpected error',
      message: error.message,
      traceId
    });
  }
}
