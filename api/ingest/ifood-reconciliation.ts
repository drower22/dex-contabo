/**
 * @file dex-contabo/api/ingest/ifood-reconciliation.ts
 * @description Handler para ingestão completa de relatórios de conciliação (Contabo deployment)
 * 
 * Versão do ifood-reconciliation.ts para deployment no Contabo.
 * Orquestra o fluxo completo de obtenção e processamento de relatórios:
 * 1. Autentica com iFood (refresh token)
 * 2. Solicita geração do relatório (POST on-demand)
 * 3. Faz polling até arquivo estar pronto
 * 4. Baixa e descompacta CSV
 * 5. Salva no Supabase Storage
 * 6. Dispara processamento assíncrono no backend Python
 * 
 * FUNCIONALIDADES:
 * - POST: Inicia processo completo de ingestão
 * - GET: Consulta status da última execução
 * 
 * TABELAS:
 * - ifood_conciliation_runs: Registra cada execução
 * - ifood_conciliation_logs: Logs detalhados
 * - received_files: Arquivos para processamento
 * 
 * @example
 * POST /api/ingest/ifood-reconciliation
 * Body: { "merchantId": "abc123", "competence": "2024-03" }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import zlib from 'zlib';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const STORAGE_BUCKET = process.env.IFOOD_CONCILIATION_BUCKET ?? 'conciliacao';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_POLL_ATTEMPTS = Number(process.env.IFOOD_RECONCILIATION_POLL_ATTEMPTS ?? 12);
const POLL_INTERVAL_MS = Number(process.env.IFOOD_RECONCILIATION_POLL_INTERVAL ?? 5000);

const parseJsonSafe = <T = any>(text: string): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const traceId = Date.now().toString(36);
  let runId: string | null = null;

  const logToDb = async (level: 'debug' | 'info' | 'warn' | 'error', step: string, message: string, metadata?: any) => {
    try {
      await supabase.from('ifood_conciliation_logs').insert({
        run_id: runId,
        trace_id: traceId,
        level,
        step,
        message,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
      });
    } catch (err) {
      console.error('[ifood-ingest] log_insert_failed', { traceId, step, error: (err as Error)?.message });
    }
  };

  try {
    const { storeId, merchantId: merchantIdIn, competence, triggerSource, reportId: reportIdOverride } = req.body || {};
    
    await logToDb('info', 'init', 'Iniciando processo de conciliação', { storeId, merchantIdIn, competence, triggerSource });
    
    if (!competence) {
      await logToDb('error', 'validation', 'Competence ausente', { body: req.body });
      console.error('[ifood-ingest] missing_competence', { traceId, body: req.body });
      return res.status(400).json({ error: 'competence (YYYY-MM) é obrigatório', traceId });
    }

    let accountId: string | null = null;
    let merchantId: string | null = merchantIdIn || null;

    if (merchantId) {
      const { data } = await supabase.from('accounts').select('id').eq('ifood_merchant_id', merchantId).maybeSingle();
      accountId = data?.id || null;
    } else if (storeId) {
      let acc = await supabase.from('accounts').select('id, ifood_merchant_id').eq('id', storeId).maybeSingle();
      if (!acc.data) acc = await supabase.from('accounts').select('id, ifood_merchant_id').eq('ifood_merchant_id', storeId).maybeSingle();
      accountId = acc.data?.id || null;
      merchantId = acc.data?.ifood_merchant_id || null;
    }

    if (!merchantId) {
      await logToDb('error', 'validation', 'MerchantId não encontrado', { storeId, merchantIdIn });
      console.error('[ifood-ingest] merchant_not_found', { traceId, storeId, merchantIdIn });
      return res.status(400).json({ error: 'merchantId/storeId inválido ou não encontrado', traceId });
    }
    
    await logToDb('info', 'validation', 'MerchantId resolvido', { merchantId, accountId });

    const trigger = (triggerSource as string) ?? 'manual_topbar';
    // Usar a URL da API configurada em vez de construir a partir dos headers
    const selfBase = process.env.API_BASE_URL || process.env.CONTABO_API_URL || 'https://api.usa-dex.com.br';

    const nowIso = new Date().toISOString();
    const persistRun = async (patch: Record<string, any>) => {
      if (!runId) return;
      const { error } = await supabase
        .from('ifood_conciliation_runs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', runId);
      if (error) {
        console.error('[ifood-ingest] run_update_failed', { traceId, runId, error: error.message });
      }
    };

    const insertRun = await supabase
      .from('ifood_conciliation_runs')
      .insert({ account_id: accountId, merchant_id: merchantId, competence, trigger_source: trigger, status: 'pending', requested_at: nowIso })
      .select('id')
      .single();

    if (insertRun.error) {
      await logToDb('error', 'run_insert', 'Falha ao criar registro de execução', { error: insertRun.error.message });
      console.error('[ifood-ingest] run_insert_failed', { traceId, merchantId, accountId, error: insertRun.error.message });
      return res.status(500).json({ error: 'run_insert_failed', details: insertRun.error.message, traceId });
    }

    runId = insertRun.data?.id ?? null;
    await logToDb('info', 'run_insert', 'Registro de execução criado', { runId });

    const markError = async (message: string, status = 500) => {
      await persistRun({ status: 'error', finished_at: new Date().toISOString(), error_message: message });
      if (!res.headersSent) res.status(status).json({ error: message, traceId });
    };

    const refreshResp = await fetch(`${selfBase}/api/ifood-auth/refresh?scope=financial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: merchantId }),
    });
    const tokenText = await refreshResp.text();
    const tokenJson = parseJsonSafe<{ access_token?: string }>(tokenText);
    if (!refreshResp.ok || !tokenJson?.access_token) {
      await logToDb('error', 'auth', 'Falha ao obter token', { status: refreshResp.status, response: tokenText.slice(0, 200) });
      await markError('refresh_failed', refreshResp.status || 500);
      return;
    }
    const accessToken = tokenJson.access_token;
    const tokenPreview = `${accessToken.slice(0, 6)}...${accessToken.slice(-4)}`;
    await logToDb('info', 'auth', 'Token obtido com sucesso', { tokenPreview });
    console.info('[ifood-ingest] access_token_received', { traceId, tokenPreview });

    await persistRun({ status: 'running', started_at: new Date().toISOString() });

    const requestParams = new URLSearchParams({ action: 'request', merchantId, competence });
    const requestResp = await fetch(`${selfBase}/api/ifood/reconciliation?${requestParams.toString()}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-ifood-token': accessToken },
    });
    const requestBody = await requestResp.text();
    
    let requestJson: any = {};
    let reportId: string | null = null;

    if (!requestResp.ok) {
      const errorJson = parseJsonSafe<any>(requestBody) || {};
      let extractedId: string | null = null;
      const candidates = [
        errorJson?.requestId,
        errorJson?.normalizedRequestId,
        errorJson?.id,
        typeof errorJson?.details === 'string' ? (errorJson.details.match(/([a-f0-9-]{36})/i)?.[1] ?? null) : null,
        typeof errorJson?.message === 'string' ? (errorJson.message.match(/([a-f0-9-]{36})/i)?.[1] ?? null) : null,
        requestBody.match(/request\s+id[:\s]+([a-f0-9-]{36})/i)?.[1] ?? null,
      ];
      extractedId = candidates.find((val) => !!val) ?? null;

      if (requestResp.status === 409 && extractedId) {
        reportId = extractedId;
        requestJson = errorJson;
        await logToDb('warn', 'request', 'Reutilizando requestId existente', { reportId, reason: 'duplicate_request', payload: errorJson });
        console.info('[ifood-ingest] reusing_existing_request_id', { traceId, reportId, merchantId, competence, payload: errorJson });
      } else {
        await logToDb('error', 'request', 'Falha ao solicitar relatório', { status: requestResp.status, body: requestBody.slice(0, 300) });
        await markError(`request_failed: ${requestBody}`, requestResp.status);
        return;
      }
    } else {
      requestJson = parseJsonSafe<any>(requestBody) || {};
      reportId = reportIdOverride || requestJson?.normalizedRequestId || requestJson?.requestId || requestJson?.id;
      await logToDb('info', 'request', 'Relatório solicitado com sucesso', { reportId });
    }

    if (!reportId) {
      await markError('report_id_missing', 500);
      return;
    }

    await persistRun({ request_id: requestJson?.requestId ?? null, report_id: reportId, status: 'running' });

    let csvText: string | null = null;
    let lastStatusPayload: any = null;
    let finalDownloadUrl: string | null = null;
    for (let attempts = 0; attempts < MAX_POLL_ATTEMPTS; attempts++) {
      const downloadParams = new URLSearchParams({ action: 'download', merchantId, reportId, competence });
      const downloadResp = await fetch(`${selfBase}/api/ifood/reconciliation?${downloadParams.toString()}`, {
        headers: { Accept: 'text/csv,application/json,*/*', 'x-ifood-token': accessToken },
      });
      const contentType = (downloadResp.headers.get('content-type') || '').toLowerCase();

      // CSV direto (text/csv)
      if (downloadResp.ok && contentType.includes('text/csv')) {
        csvText = await downloadResp.text();
        finalDownloadUrl = lastStatusPayload?.downloadUrl ?? lastStatusPayload?.filePath ?? null;
        await logToDb('info', 'download', 'CSV baixado com sucesso', { attempts, size: csvText.length, contentType });
        break;
      }

      // CSV compactado (gzip)
      if (downloadResp.ok && (contentType.includes('application/gzip') || contentType.includes('application/octet-stream'))) {
        const buffer = Buffer.from(await downloadResp.arrayBuffer());
        try {
          const decompressed = await new Promise<Buffer>((resolve, reject) => {
            zlib.gunzip(buffer, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          csvText = decompressed.toString('utf-8');
          finalDownloadUrl = lastStatusPayload?.downloadUrl ?? lastStatusPayload?.filePath ?? null;
          await logToDb('info', 'download', 'CSV baixado e descompactado', { attempts, size: csvText.length, contentType });
          break;
        } catch (err: any) {
          await logToDb('error', 'download', 'Falha ao descompactar arquivo gzip', { error: err?.message });
          await markError(`download_gunzip_failed: ${err?.message}`, 500);
          return;
        }
      }

      if (downloadResp.status === 202 && contentType.includes('application/json')) {
        const downloadText = await downloadResp.text();
        lastStatusPayload = parseJsonSafe<any>(downloadText) ?? null;
        
        // Detectar se o relatório falhou no iFood
        if (lastStatusPayload?.status === 'error') {
          const errorMsg = lastStatusPayload?.message || lastStatusPayload?.errorMessage || 'Relatório falhou no iFood';
          await logToDb('error', 'download', 'Relatório retornou erro do iFood', { 
            status: lastStatusPayload?.status,
            message: errorMsg,
            payload: lastStatusPayload 
          });
          await markError(`ifood_report_error: ${errorMsg}`, 422);
          return;
        }
        
        await logToDb('info', 'download', `Aguardando processamento (tentativa ${attempts + 1}/${MAX_POLL_ATTEMPTS})`, { 
          status: lastStatusPayload?.status,
          message: lastStatusPayload?.message 
        });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const fallbackText = await downloadResp.text();
      await logToDb('error', 'download', 'Falha ao baixar CSV', { status: downloadResp.status, body: fallbackText.slice(0, 300), contentType });
      await markError(`download_failed: ${fallbackText}`, downloadResp.status || 500);
      return;
    }

    if (!csvText) {
      await logToDb('error', 'download', 'Timeout ao aguardar CSV', { attempts: MAX_POLL_ATTEMPTS });
      await markError('download_timeout', 504);
      return;
    }

    await persistRun({ status: 'processing', download_url: finalDownloadUrl });

    // Salvar CSV no bucket para processamento pelo backend estável
    const fileId = randomUUID();
    const now = new Date();
    const normalizedCompetence = typeof competence === 'string' && competence.trim().length >= 7
      ? competence.trim().slice(0, 7)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const importStamp = now.toISOString().replace(/[:.]/g, '-');
    const fileName = `${normalizedCompetence}-${importStamp}-${fileId}.csv`;
    const fileKey = `${accountId}/${normalizedCompetence}/${fileName}`;
    
    try {
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(fileKey, Buffer.from(csvText, 'utf-8'), {
          contentType: 'text/csv',
          upsert: false,
        });
      
      if (uploadError) {
        await logToDb('error', 'storage', 'Falha ao salvar CSV no bucket', { error: uploadError.message, fileKey });
        throw new Error(`Falha ao salvar CSV: ${uploadError.message}`);
      }
      
      await logToDb('info', 'storage', 'CSV armazenado no bucket para processamento async', { 
        fileKey, 
        totalRows: csvText.split(/\r?\n/).length 
      });
      
      // Registrar em received_files
      const storagePath = `${STORAGE_BUCKET}/${fileKey}`;
      const { error: insertError } = await supabase
        .from('received_files')
        .insert({
          id: fileId,
          account_id: accountId,
          storage_path: storagePath,
          status: 'pending',
        });
      
      if (insertError) {
        await logToDb('warn', 'storage', 'Falha ao registrar em received_files', { error: insertError.message });
      } else {
        await logToDb('info', 'storage', 'Arquivo registrado em received_files', { fileId, storagePath });
      }
      
      // Chamar endpoint de processamento no backend Contabo
      const processEndpoint = process.env.BACKEND_PROCESS_URL || 'https://api.usa-dex.com.br/processar-planilha-conciliacao';
      await logToDb('info', 'processing', 'Disparando processamento no backend', { endpoint: processEndpoint, fileId });
      
      fetch(processEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, storage_path: storagePath }),
      }).then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          await logToDb('error', 'processing', 'Falha ao processar arquivo', { 
            status: response.status, 
            error: errorText 
          });
        } else {
          const result = await response.json() as { inserted?: number; errors?: any[] };
          await logToDb('info', 'processing', 'Arquivo processado com sucesso', { 
            fileId,
            inserted: result.inserted,
            errors: result.errors
          });
        }
      }).catch(async (err) => {
        console.error('[ifood-ingest] failed to process file', { fileId, error: err?.message });
        await logToDb('error', 'processing', 'Erro ao processar arquivo', { 
          error: err?.message,
          endpoint: processEndpoint
        });
      });
      
    } catch (storageErr: any) {
      await logToDb('error', 'storage', 'Erro ao salvar/processar CSV', { error: storageErr?.message });
      // Não bloquear o fluxo - continuar com resposta de sucesso
    }

    // Finalizar run com sucesso - processamento será feito de forma assíncrona pelo backend estável
    await persistRun({ 
      status: 'success', 
      finished_at: new Date().toISOString(), 
      rows_processed: csvText.split(/\r?\n/).length - 1 // Aproximação: total de linhas - header
    });
    
    await logToDb('info', 'complete', 'CSV baixado e salvo. Processamento delegado ao backend estável', { 
      fileId, 
      runId 
    });
    
    return res.status(200).json({ 
      message: 'CSV baixado e processamento agendado',
      traceId, 
      runId,
      fileId,
      status: 'processing_async'
    });
  } catch (e: any) {
    await logToDb('error', 'exception', 'Erro inesperado', { error: e?.message, stack: e?.stack?.slice(0, 500) });
    console.error('[ifood-ingest] unexpected_error', { traceId, error: e?.message, stack: e?.stack });
    if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: e?.message || String(e), traceId });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const merchantId = (req.query.merchantId || '').toString().trim();
  if (!merchantId) return res.status(400).json({ error: 'merchantId é obrigatório' });

  try {
    const { data, error } = await supabase
      .from('ifood_conciliation_runs')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[conciliation-status] supabase_error', { merchantId, error: error.message });
      return res.status(500).json({ error: 'Erro ao consultar status', details: error.message });
    }
    if (!data?.length) return res.status(404).json({ error: 'Nenhuma execução encontrada' });

    return res.status(200).json({ run: data[0], runs: data });
  } catch (err: any) {
    console.error('[conciliation-status] unexpected_error', { merchantId, error: err?.message });
    return res.status(500).json({ error: 'Erro inesperado', details: err?.message });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}