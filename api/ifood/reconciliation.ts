import type { VercelRequest, VercelResponse } from '@vercel/node';
import zlib from 'zlib';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-request-homologation, x-client-info, apikey, content-type'
} as const;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_FINANCIAL_V3 = `${IFOOD_BASE_URL}/financial/v3.0`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', cors['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);
  if (req.method === 'OPTIONS') return res.status(200).send('ok');

  const traceId = Date.now().toString(36);
  res.setHeader('X-Trace-Id', traceId);

  try {
    // Auth distribuída: exige token por loja
    const tokenHeader = (req.headers['x-ifood-token'] || req.headers['authorization'] || '') as string;
    const token = tokenHeader?.toLowerCase().startsWith('bearer ') ? tokenHeader.slice(7) : tokenHeader;
    if (!token) {
      console.error('[ifood-reconciliation] missing_token', { traceId, headers: req.headers });
      return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });
    }

    const url = new URL(req.url || '/', 'https://local');
    const merchantId = (url.searchParams.get('merchantId') || '').trim();
    const competence = (url.searchParams.get('competence') || '').trim();
    const year = url.searchParams.get('year');
    const month = url.searchParams.get('month');

    let finalCompetence = competence;
    if (!finalCompetence && year && month) {
      const mm = String(parseInt(month, 10)).padStart(2, '0');
      finalCompetence = `${year}-${mm}`;
    }

    if (!merchantId || !finalCompetence) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios: merchantId e competence (ou year + month).', traceId });
    }

    // 1) Solicitar conciliação on-demand (POST) e obter requestId
    const baseHeaders: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const homo = (req.headers['x-request-homologation'] || '').toString().trim().toLowerCase();
    if (homo === 'true' || homo === '1') baseHeaders['x-request-homologation'] = 'true';

    const generateUrl = `${IFOOD_FINANCIAL_V3}/merchants/${encodeURIComponent(merchantId)}/reconciliation/on-demand`;
    const generateResp = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ competence: finalCompetence }),
    });
    console.info('[ifood-reconciliation] POST generate', { traceId, generateUrl, merchantId, competence: finalCompetence });

    const generateText = await generateResp.text().catch(() => '');
    if (!generateResp.ok) {
      console.error('[ifood-reconciliation] generate_failed', { traceId, status: generateResp.status, body: generateText, generateUrl, merchantId, competence: finalCompetence });
      return res.status(generateResp.status).json({ error: 'Erro ao solicitar conciliação on-demand', details: generateText, traceId });
    }

    let generatePayload: any = {};
    try {
      generatePayload = generateText ? JSON.parse(generateText) : {};
    } catch (err) {
      console.warn('[ifood-reconciliation] generate_invalid_json', { traceId, snippet: generateText.slice(0, 500), err: (err as Error)?.message });
    }

    const requestId = generatePayload?.requestId || generatePayload?.requestID || generatePayload?.id;
    if (!requestId) {
      console.error('[ifood-reconciliation] request_id_missing', { traceId, payload: generatePayload, merchantId, competence: finalCompetence });
      return res.status(502).json({ error: 'request_id_missing', details: generatePayload, traceId });
    }

    // 2) Poll do request até obter download
    const fetchUrl = `${IFOOD_FINANCIAL_V3}/merchants/${encodeURIComponent(merchantId)}/reconciliation/on-demand/${encodeURIComponent(requestId)}`;
    const maxAttempts = 10;
    const waitMs = 1500;
    let downloadUrl: string | null = null;
    let lastStatus: number | null = null;
    let lastBodySnippet: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const pollResp = await fetch(fetchUrl, { headers: baseHeaders });
      lastStatus = pollResp.status;
      const pollText = await pollResp.text().catch(() => '');
      lastBodySnippet = pollText.slice(0, 500);
      console.info('[ifood-reconciliation] poll_attempt', { traceId, attempt, status: pollResp.status });

      if (pollResp.status === 202) {
        console.info('[ifood-reconciliation] poll_pending', { traceId, attempt, fetchUrl });
      } else if (pollResp.status === 404) {
        console.warn('[ifood-reconciliation] poll_not_ready', { traceId, attempt, fetchUrl, bodySnippet: lastBodySnippet });
      } else if (!pollResp.ok) {
        console.error('[ifood-reconciliation] poll_failed', { traceId, attempt, status: pollResp.status, fetchUrl, bodySnippet: lastBodySnippet });
        return res.status(pollResp.status).json({ error: 'Erro ao consultar conciliação on-demand', details: pollText, traceId });
      } else {
        let pollPayload: any = {};
        try {
          pollPayload = pollText ? JSON.parse(pollText) : {};
        } catch (err) {
          console.error('[ifood-reconciliation] poll_invalid_json', { traceId, attempt, text: lastBodySnippet, err: (err as Error)?.message });
          return res.status(502).json({ error: 'Resposta inválida ao consultar conciliação', details: lastBodySnippet, traceId });
        }

        downloadUrl = pollPayload?.downloadPath ?? pollPayload?.downloadUrl ?? pollPayload?.url ?? null;
        if (downloadUrl) {
          console.info('[ifood-reconciliation] download_ready', { traceId, attempt, fetchUrl, requestId });
          break;
        }
        console.warn('[ifood-reconciliation] download_missing_in_poll', { traceId, attempt, payload: pollPayload });
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    if (!downloadUrl) {
      console.error('[ifood-reconciliation] download_unavailable', { traceId, fetchUrl, requestId, attempts: maxAttempts, lastStatus, lastBodySnippet });
      return res.status(504).json({ error: 'Arquivo de conciliação não ficou pronto a tempo', traceId });
    }

    // 3) Baixar .gz
    console.info('[ifood-reconciliation] download_start', { traceId, downloadUrl });
    const fileResp = await fetch(downloadUrl, { headers: baseHeaders });
    if (!fileResp.ok) {
      const body = await fileResp.text().catch(() => '');
      console.error('[ifood-reconciliation] download_fetch_failed', { traceId, status: fileResp.status, downloadUrl, snippet: body.slice(0, 300) });
      return res.status(fileResp.status).json({ error: 'Erro ao baixar o arquivo de conciliação', traceId });
    }
    const fileCt = fileResp.headers.get('content-type') || '';
    if (fileCt.includes('text/html')) {
      const html = await fileResp.text();
      console.error('[ifood-reconciliation] download_html_response', { traceId, downloadUrl, snippet: html.slice(0, 300) });
      return res.status(404).json({ error: 'HTML recebido ao baixar .gz. Link expirado ou inválido.', hint: 'Tente gerar novamente o downloadUrl.', details: html.slice(0, 300), traceId });
    }

    const gzBuffer = Buffer.from(await fileResp.arrayBuffer());

    // 3) Gunzip e retornar CSV com encoding correto
    zlib.gunzip(gzBuffer, (err, out) => {
      if (err) {
        console.error('[ifood-reconciliation] gunzip error', { traceId, err: err.message });
        return res.status(500).json({ error: 'Falha ao descompactar arquivo', traceId });
      }
      
      // Tentar detectar encoding: iFood geralmente usa ISO-8859-1 ou Windows-1252
      let csvText: string;
      try {
        // Tentar UTF-8 primeiro
        csvText = out.toString('utf-8');
        // Se contiver caracteres de substituição (�), tentar latin1
        if (csvText.includes('�')) {
          csvText = out.toString('latin1');
          console.info('[ifood-reconciliation] using_latin1_encoding', { traceId });
        }
      } catch {
        // Fallback para latin1
        csvText = out.toString('latin1');
        console.warn('[ifood-reconciliation] fallback_to_latin1', { traceId });
      }
      
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('X-Trace-Id', traceId);
      res.send(csvText);
    });
  } catch (e: any) {
    console.error('[ifood-reconciliation] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor', details: e?.message || String(e), traceId });
  }
}
