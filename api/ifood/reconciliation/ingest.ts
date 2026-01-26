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
import { logError, logEvent } from '../../../services/app-logger';

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim(); // ex: https://proxy.usa-dex.com.br/api/ifood-proxy
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();   // chave compartilhada com o proxydex
const STORAGE_BUCKET = 'conciliacao';
const MAX_POLL_ATTEMPTS = 24; // 24 tentativas x 5s = 2 minutos
const POLL_INTERVAL_MS = 5000; // 5 segundos

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

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

  let runId: string | null = null;

  const logToDb = async (
    level: 'debug' | 'info' | 'warn' | 'error',
    step: string,
    message: string,
    metadata?: any,
  ) => {
    try {
      await logEvent({
        level,
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-reconciliation-ingest',
        event: `ifood.conciliation.${step}`,
        message,
        trace_id: traceId,
        run_id: runId,
        data: metadata ? JSON.parse(JSON.stringify(metadata)) : {},
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[reconciliation-ingest] log_emit_failed', { traceId, step, error: err?.message });
    }
  };

  type CentralLogLevel = 'info' | 'warn' | 'error';

  const logCentral = async (
    level: CentralLogLevel,
    message: string,
    accountIdForLog?: string | null,
    context?: any,
  ) => {
    try {
      await logEvent({
        level,
        marketplace: 'ifood',
        source: 'dex-contabo/api',
        service: 'ifood-reconciliation-ingest',
        event: String(message || 'ifood.conciliation.event'),
        message: String(message || 'conciliation'),
        trace_id: traceId,
        run_id: runId,
        account_id: accountIdForLog ?? null,
        data: context ? JSON.parse(JSON.stringify(context)) : {},
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[reconciliation-ingest] central_log_emit_failed', { traceId, level, message, error: err?.message });
    }
  };

  const persistRun = async (patch: Record<string, any>) => {
    if (!runId) return;
    try {
      const { error } = await supabase
        .from('ifood_conciliation_runs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', runId);
      if (error) {
        console.error('[reconciliation-ingest] run_update_failed', {
          traceId,
          runId,
          error: error.message,
        });
      }
    } catch (err: any) {
      console.error('[reconciliation-ingest] run_update_exception', {
        traceId,
        runId,
        error: err?.message,
      });
    }
  };

  console.log('[reconciliation-ingest] START', {
    traceId,
    method: req.method,
    body: req.body,
    hasSupabase: !!process.env.SUPABASE_URL,
  });

  try {
    // 1. Validar método
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Extrair parâmetros
    const { merchantId, competence, storeId, triggerSource } = req.body;

    if (!merchantId || !competence) {
      await logToDb('error', 'validation', 'Missing merchantId/competence', {
        merchantId,
        competence,
      });
      console.error('[reconciliation-ingest] Missing parameters', {
        traceId,
        merchantId,
        competence,
      });
      return res.status(400).json({
        error: 'Missing required parameters: merchantId, competence',
      });
    }

    // 2.1 Resolver accountId (usado em ifood_conciliation_runs)
    let accountId: string | null = null;
    try {
      if (storeId) {
        let acc = await supabase
          .from('accounts')
          .select('id, ifood_merchant_id')
          .eq('id', storeId)
          .maybeSingle();
        if (!acc.data) {
          acc = await supabase
            .from('accounts')
            .select('id, ifood_merchant_id')
            .eq('ifood_merchant_id', storeId)
            .maybeSingle();
        }
        accountId = acc.data?.id ?? null;
      } else if (merchantId) {
        const { data } = await supabase
          .from('accounts')
          .select('id')
          .eq('ifood_merchant_id', merchantId)
          .maybeSingle();
        accountId = data?.id ?? null;
      }
    } catch (err: any) {
      await logToDb('warn', 'resolve_account', 'Falha ao resolver accountId (seguindo mesmo assim)', {
        error: err?.message,
        merchantId,
        storeId,
      });
    }

    const trigger = (triggerSource as string) ?? 'manual_topbar';
    const nowIso = new Date().toISOString();

    // 2.2 Criar run em ifood_conciliation_runs (status pending)
    try {
      const insertRun = await supabase
        .from('ifood_conciliation_runs')
        .insert({
          account_id: accountId,
          merchant_id: merchantId,
          competence,
          trigger_source: trigger,
          status: 'pending',
          requested_at: nowIso,
        })
        .select('id')
        .single();

      if (insertRun.error) {
        await logToDb('error', 'run_insert', 'Falha ao criar registro de execução', {
          error: insertRun.error.message,
          merchantId,
          accountId,
        });
      } else {
        runId = insertRun.data?.id ?? null;
        await logToDb('info', 'run_insert', 'Registro de execução criado', { runId });
        await logCentral('info', 'ifood_conciliation.start', accountId ?? null, {
          feature: 'ifood_conciliation',
          system: 'dex-api',
          stage: 'start',
          status: 'started',
          run_id: runId,
          trace_id: traceId,
          merchant_id: merchantId,
          store_id: storeId,
          competence,
          trigger_source: trigger,
        });
      }
    } catch (err: any) {
      await logToDb('error', 'run_insert_exception', 'Exceção ao criar registro de execução', {
        error: err?.message,
        merchantId,
        accountId,
      });
    }

    // 3. Buscar token descriptografado via Edge Function (scope financial)
    console.log('[reconciliation-ingest] Fetching token via ifood-get-token (Supabase Edge Function)', {
      traceId,
      storeId: storeId || 'not provided',
      merchantId,
    });

    const storeIdForToken = storeId || merchantId;
    const { data: tokenData, error: tokenError } = await supabase.functions.invoke('ifood-get-token', {
      body: { storeId: storeIdForToken, scope: 'financial' },
    });

    if (tokenError || !tokenData?.access_token) {
      await logToDb('error', 'auth', 'No token found via ifood-get-token', {
        storeIdForToken,
        merchantId,
        error: tokenError?.message,
      });
      await logCentral('error', 'ifood_conciliation.error', accountId ?? null, {
        feature: 'ifood_conciliation',
        system: 'dex-api',
        stage: 'auth',
        status: 'error',
        run_id: runId,
        trace_id: traceId,
        merchant_id: merchantId,
        store_id: storeId,
        competence,
        error_stage: 'auth',
        error_message: tokenError?.message || 'No token found via ifood-get-token',
      });
      console.error('[reconciliation-ingest] No token found via ifood-get-token', {
        traceId,
        storeId: storeIdForToken,
        merchantId,
        error: tokenError?.message,
      });
      return res.status(401).json({
        error: 'No valid financial token found',
        details: tokenError?.message,
      });
    }

    const token = tokenData.access_token as string;
    const expiresAt = (tokenData as any).expires_at as string | undefined;

    console.log('[reconciliation-ingest] Token info', {
      traceId,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...',
      tokenEnd: '...' + token.substring(token.length - 20),
      expiresAt,
    });

    await logToDb('info', 'auth', 'Token financeiro obtido com sucesso', {
      tokenLength: token.length,
      expiresAt,
    });

    // 4. Solicitar geração do relatório (POST on-demand)
    // Alinhar com o handler de download: financial/v3.0 + /reconciliation/on-demand
    const generatePath = `/financial/v3.0/merchants/${encodeURIComponent(merchantId)}/reconciliation/on-demand`;
    const usingProxy = !!IFOOD_PROXY_BASE && !!IFOOD_PROXY_KEY;

    let requestUrl = '';
    const requestBody = { competence };
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (usingProxy) {
      const proxyUrl = new URL(IFOOD_PROXY_BASE!);
      proxyUrl.searchParams.set('path', generatePath);
      requestUrl = proxyUrl.toString();
      requestHeaders['x-shared-key'] = IFOOD_PROXY_KEY!;
    } else {
      requestUrl = `${IFOOD_BASE_URL}${generatePath}`;
    }

    console.log('[reconciliation-ingest] Requesting report generation', {
      traceId,
      url: requestUrl,
      usingProxy,
      generatePath,
      competence,
      merchantId,
    });

    const requestResponse = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    console.log('[reconciliation-ingest] iFood request response', {
      traceId,
      status: requestResponse.status,
      statusText: requestResponse.statusText,
      headers: Object.fromEntries(requestResponse.headers.entries())
    });

    let requestId: string | null = null;
    let requestData: any = null;

    if (!requestResponse.ok) {
      const errorText = await requestResponse.text();
      console.error('[reconciliation-ingest] iFood request error', {
        traceId,
        status: requestResponse.status,
        body: errorText
      });

      // 409 = já existe solicitação recente (cache de 6h)
      if (requestResponse.status === 409) {
        try {
          const parsed = JSON.parse(errorText);
          const message = typeof parsed?.message === 'string' ? parsed.message : undefined;
          let extractedRequestId: string | null = null;

          if (message) {
            const match = message.match(/request Id:\s*([0-9a-f-]+)/i);
            if (match && match[1]) {
              extractedRequestId = match[1];
            }
          }

          if (extractedRequestId) {
            requestId = extractedRequestId;
            console.log('[reconciliation-ingest] Reusing existing requestId from 409 conflict', {
              traceId,
              requestId,
              competence,
            });
            await logToDb('warn', 'request', 'Reutilizando requestId existente a partir de 409', {
              requestId,
              competence,
            });
          } else {
            return res.status(409).json({
              error: 'Conflito: Já existe uma solicitação recente para esta competência (cache de 6 horas)',
              competence,
              details: errorText
            });
          }
        } catch (parseError: any) {
          console.warn('[reconciliation-ingest] Failed to parse 409 response body', {
            traceId,
            error: parseError?.message,
            rawBody: errorText,
          });
          return res.status(409).json({
            error: 'Conflito: Já existe uma solicitação recente para esta competência (cache de 6 horas)',
            competence,
            details: errorText
          });
        }
      } else {
        return res.status(requestResponse.status).json({
          error: 'iFood API error on request',
          status: requestResponse.status,
          message: errorText
        });
      }
    }

    if (!requestId) {
      requestData = await requestResponse.json() as any;
      requestId = requestData.requestId;
    }

    if (!requestId) {
      console.error('[reconciliation-ingest] No requestId returned', { traceId, requestData });
      await logToDb('error', 'request', 'Nenhum requestId retornado do iFood', {
        requestData,
      });
      return res.status(500).json({
        error: 'No requestId returned from iFood',
        data: requestData,
      });
    }

    console.log('[reconciliation-ingest] Report requested successfully', {
      traceId,
      requestId,
      competence,
    });
    await logToDb('info', 'request', 'Relatório solicitado com sucesso', {
      requestId,
      competence,
    });

    await persistRun({ status: 'running', request_id: requestId });

    // 5. Polling até arquivo estar pronto
    let fileUrl: string | null = null;
    let attempt = 0;

    while (attempt < MAX_POLL_ATTEMPTS && !fileUrl) {
      attempt++;
      await sleep(POLL_INTERVAL_MS);

      const pollPath = `/financial/v3.0/merchants/${encodeURIComponent(merchantId)}/reconciliation/on-demand/${encodeURIComponent(requestId)}`;

      let pollUrl = '';
      const pollHeaders: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      };

      if (usingProxy) {
        const proxyUrl = new URL(IFOOD_PROXY_BASE!);
        proxyUrl.searchParams.set('path', pollPath);
        pollUrl = proxyUrl.toString();
        pollHeaders['x-shared-key'] = IFOOD_PROXY_KEY!;
      } else {
        pollUrl = `${IFOOD_BASE_URL}${pollPath}`;
      }

      console.log('[reconciliation-ingest] Polling attempt', {
        traceId,
        attempt,
        maxAttempts: MAX_POLL_ATTEMPTS,
        pollUrl,
        usingProxy,
        pollPath,
      });

      const pollResponse = await fetch(pollUrl, {
        method: 'GET',
        headers: pollHeaders,
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
      const rawStatus = pollData.status;
      const normalizedStatus = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : rawStatus;
      const downloadUrl = pollData.fileUrl || pollData.filePath;

      console.log('[reconciliation-ingest] Poll response', {
        traceId,
        attempt,
        status: rawStatus,
        normalizedStatus,
        fileUrl: downloadUrl
      });

      if (normalizedStatus === 'processed' && downloadUrl) {
        fileUrl = downloadUrl;
      } else if (normalizedStatus === 'error' || normalizedStatus === 'failed') {
        console.error('[reconciliation-ingest] Report generation failed', {
          traceId,
          pollData,
        });
        await logToDb('error', 'download', 'Report generation failed (status error/failed)', {
          pollData,
          attempt,
        });
        await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: 'ifood_report_error' });
        return res.status(500).json({
          error: 'Report generation failed',
          requestId,
          data: pollData,
        });
      }
    }

    if (!fileUrl) {
      console.error('[reconciliation-ingest] Timeout waiting for file', {
        traceId,
        requestId,
      });
      await logToDb('error', 'download', 'Timeout ao aguardar CSV', {
        requestId,
        attempts: attempt,
      });
      await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: 'download_timeout' });
      return res.status(408).json({
        error: 'Timeout waiting for report file',
        requestId,
        attempts: attempt,
      });
    }

    console.log('[reconciliation-ingest] File ready', {
      traceId,
      requestId,
      fileUrl,
      attempts: attempt,
    });
    await logToDb('info', 'download', 'Arquivo remoto pronto para download', {
      requestId,
      fileUrl,
      attempts: attempt,
    });
    await persistRun({ status: 'processing', download_url: fileUrl });

    // 6. Baixar arquivo
    console.log('[reconciliation-ingest] Downloading file', { traceId, fileUrl });
    
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      console.error('[reconciliation-ingest] File download error', {
        traceId,
        status: fileResponse.status
      });
      await logToDb('error', 'download', 'Erro ao baixar arquivo CSV final', {
        status: fileResponse.status,
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
    // Padrão: concialiacao/{accountId}/{AAAA-MM}/{arquivo-com-data}.csv
    const accountFolder = storeId || merchantId;
    const competenceFolder = competence;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${competenceFolder}-${timestamp}.csv`;
    const pathInBucket = `${accountFolder}/${competenceFolder}/${fileName}`;
    const storagePath = `${STORAGE_BUCKET}/${pathInBucket}`;

    console.log('[reconciliation-ingest] Uploading to Supabase', {
      traceId,
      bucket: STORAGE_BUCKET,
      pathInBucket,
      storagePath,
    });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(pathInBucket, csvBuffer, {
        contentType: 'text/csv',
        upsert: false
      });

    if (uploadError) {
      console.error('[reconciliation-ingest] Upload error', {
        traceId,
        error: uploadError
      });
      await logCentral('error', 'ifood_conciliation.error', accountId ?? null, {
        feature: 'ifood_conciliation',
        system: 'dex-api',
        stage: 'storage_upload',
        status: 'error',
        run_id: runId,
        trace_id: traceId,
        storage_path: storagePath,
        path_in_bucket: pathInBucket,
        error_stage: 'storage_upload',
        error_message: uploadError.message,
      });
      await logToDb('error', 'storage', 'Falha ao salvar CSV no bucket', {
        error: uploadError.message,
        pathInBucket,
      });
      await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: 'storage_upload_failed' });
      return res.status(500).json({
        error: 'Failed to upload file to storage',
        details: uploadError.message
      });
    }

    console.log('[reconciliation-ingest] File uploaded successfully', {
      traceId,
      uploadData,
      storagePath,
      pathInBucket,
    });
    await logToDb('info', 'storage', 'CSV armazenado no bucket para processamento async', {
      storagePath,
      pathInBucket,
    });

    // 9. Registrar na tabela received_files para processamento Python
    const receivedFileId = randomUUID();
    const { error: insertError } = await supabase
      .from('received_files')
      .insert({
        id: receivedFileId,
        account_id: accountFolder,
        storage_path: storagePath,
        status: 'pending',
      });

    if (insertError) {
      console.error('[reconciliation-ingest] Failed to register file', {
        traceId,
        error: insertError,
      });
      await logCentral('error', 'ifood_conciliation.error', accountId ?? null, {
        feature: 'ifood_conciliation',
        system: 'dex-api',
        stage: 'register_received_file',
        status: 'error',
        run_id: runId,
        trace_id: traceId,
        storage_path: storagePath,
        file_id: receivedFileId,
        error_stage: 'register_received_file',
        error_message: insertError.message,
      });
      await logToDb('warn', 'storage', 'Falha ao registrar em received_files', {
        error: insertError.message,
      });
      await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: 'received_files_insert_failed' });
      return res.status(500).json({
        error: 'Failed to register file for processing',
        details: insertError.message,
      });
    }
    // 10. Disparar processamento Python
    const processEndpoint = process.env.BACKEND_PROCESS_URL || 'http://127.0.0.1:8000/processar-planilha-conciliacao';

    const pythonPayload = {
      file_id: receivedFileId,
      storage_path: storagePath,
    };

    let pythonStatus: number | null = null;
    let pythonOk = false;
    let pythonBodyText: string | null = null;
    let pythonErrorMessage: string | null = null;

    try {
      const response = await fetchWithTimeout(
        processEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pythonPayload),
        },
        8000,
      );

      pythonStatus = response.status;
      pythonOk = response.ok;
      pythonBodyText = await response.text().catch(() => null);

      console.log('[reconciliation-ingest] Python processing trigger response', {
        traceId,
        status: pythonStatus,
        ok: pythonOk,
        body: (pythonBodyText || '').slice(0, 500),
      });

      await logToDb(
        pythonOk ? 'info' : 'error',
        'processing',
        pythonOk ? 'Processamento disparado no backend Python' : 'Erro ao disparar processamento no backend Python',
        {
          status: pythonStatus,
          ok: pythonOk,
          body: (pythonBodyText || '').slice(0, 500),
          endpoint: processEndpoint,
        },
      );

      if (!pythonOk) {
        pythonErrorMessage = `HTTP ${pythonStatus}`;
      }
    } catch (err: any) {
      pythonOk = false;
      pythonErrorMessage = err?.name === 'AbortError' ? 'timeout' : err?.message;
      console.error('[reconciliation-ingest] Failed to trigger Python processing', {
        traceId,
        error: pythonErrorMessage,
      });
      await logToDb('error', 'processing', 'Erro ao disparar processamento no backend Python', {
        error: pythonErrorMessage,
        endpoint: processEndpoint,
      });
      await logCentral('error', 'ifood_conciliation.error', accountId ?? null, {
        feature: 'ifood_conciliation',
        system: 'dex-api',
        stage: 'python_trigger',
        status: 'error',
        run_id: runId,
        trace_id: traceId,
        storage_path: storagePath,
        file_id: receivedFileId,
        error_stage: 'python_trigger',
        error_message: pythonErrorMessage,
      });
    }

    if (!pythonOk) {
      await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: 'python_trigger_failed' });
      return res.status(502).json({
        success: false,
        error: 'Falha ao disparar processamento no backend Python',
        details: {
          endpoint: processEndpoint,
          status: pythonStatus,
          body: pythonBodyText?.slice(0, 500) ?? null,
          error: pythonErrorMessage,
        },
        runId,
        traceId,
        receivedFileId,
        storagePath,
        competence,
        requestId,
      });
    }

    await persistRun({
      status: 'success',
      finished_at: new Date().toISOString(),
      rows_processed: undefined,
      download_url: undefined,
    });

    await logCentral('info', 'ifood_conciliation.success', accountId ?? null, {
      feature: 'ifood_conciliation',
      system: 'dex-api',
      stage: 'finish',
      status: 'success',
      run_id: runId,
      trace_id: traceId,
      merchant_id: merchantId,
      store_id: storeId,
      competence,
      file_id: receivedFileId,
      storage_path: storagePath,
    });

    console.log('[reconciliation-ingest] SUCCESS', {
      traceId,
      requestId,
      storagePath,
      competence
    });

    return res.status(200).json({
      success: true,
      requestId,
      storagePath,
      competence,
      traceId,
      runId,
      receivedFileId,
      message: 'Relatório solicitado, baixado e registrado para processamento'
    });

  } catch (error: any) {
    console.error('[reconciliation-ingest] Unexpected error', {
      traceId,
      error: error.message,
      stack: error.stack
    });

    await logCentral('error', 'ifood_conciliation.error', undefined, {
      feature: 'ifood_conciliation',
      system: 'dex-api',
      stage: 'orchestrator',
      status: 'error',
      run_id: runId,
      trace_id: traceId,
      error_stage: 'orchestrator',
      error_message: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      error: 'Unexpected error',
      message: error.message,
      traceId
    });
  }
}
