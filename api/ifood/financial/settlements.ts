/**
 * @file dex-contabo/api/ifood/settlements.ts
 * @description Handler para repasses financeiros do iFood (Contabo deployment)
 * 
 * Versão do settlements.ts para deployment no Contabo.
 * Gerencia consulta e ingestão de dados de repasses financeiros.
 * 
 * MODOS DE OPERAÇÃO:
 * 1. Proxy simples (GET)
 * 2. Ingestão única (POST com ingest=true)
 * 3. Ingestão anual (POST com fullYear=true)
 * 
 * TABELA: ifood_settlement_items
 * 
 * @example
 * GET /api/ifood/settlements?merchantId=abc&beginPaymentDate=2024-01-01&endPaymentDate=2024-01-31
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-request-homologation, x-client-info, apikey, content-type'
} as const;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const WINDOW_DELAY_MS = Number(process.env.IFOOD_WINDOW_DELAY_MS || 400);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, options: RequestInit, tries = 3, baseDelayMs = 500) {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Re-tentativa para 429/5xx
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        lastErr = new Error(`HTTP ${res.status}`);
        const wait = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      const wait = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(wait);
    }
  }
  throw lastErr || new Error('fetchWithRetry failed');
}

const normalizeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const sanitized = String(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

// Variante por janela de PAGAMENTO (beginPaymentDate/endPaymentDate)
async function ingestSettlementsByPayment({
  merchantId,
  accountId,
  beginPay,
  endPay,
  token,
  headers,
}: {
  merchantId: string;
  accountId: string | null;
  beginPay: string; // inclusive
  endPay: string;   // exclusivo
  token: string;
  headers: Record<string, string>;
}) {
  void token;
  const qs = new URLSearchParams({
    beginPaymentDate: beginPay,
    endPaymentDate: endPay,
  });
  const settlementsUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${encodeURIComponent(merchantId)}/settlements?${qs.toString()}`;

  const apiResponse = await fetchWithRetry(settlementsUrl, {
    method: 'GET',
    headers,
  }, 3, 600);

  const rawText = await apiResponse.text();
  let settlementsPayload: SettlementResponse | null = null;
  try {
    settlementsPayload = rawText ? (JSON.parse(rawText) as SettlementResponse) : null;
  } catch {
    settlementsPayload = null;
  }

  if (!apiResponse.ok) {
    const reason = settlementsPayload && (settlementsPayload as any).message;
    return {
      status: apiResponse.status,
      body: {
        error: 'Falha ao consultar settlements (payment window) na API iFood.',
        details: reason || rawText,
        status: apiResponse.status,
        diagnostics: { url: settlementsUrl, beginPay, endPay, rawLength: rawText?.length || 0 },
      },
    };
  }

  const settlements = Array.isArray(settlementsPayload?.settlements) ? settlementsPayload!.settlements! : [];
  const nowIso = new Date().toISOString();
  let processed = 0;

  const rows = settlements.flatMap((settlement) => {
    const settlementId = String(settlement?.id || settlement?.settlementId || randomUUID());
    const settlementType = settlement?.settlementType || settlement?.type || null;
    const startCalc = toDateOnly(settlement?.startDateCalculation || settlement?.startDate) || beginPay;
    const endCalcV = toDateOnly(settlement?.endDateCalculation || settlement?.endDate) || endPay;
    const expectedPayment = toDateOnly(settlement?.expectedPaymentDate);
    const items = Array.isArray(settlement?.closingItems) ? settlement!.closingItems! : [];

    return items.map((item: any, index: number) => {
      processed += 1;
      const accountDetails = item?.accountDetails ?? {};
      const raw = { settlement, item };
      const itemId = item?.id ? String(item.id) : `${settlementId}-${index}`;
      return {
        id: randomUUID(),
        merchant_id: merchantId,
        account_id: accountId || null,
        settlement_id: settlementId,
        settlement_type: settlementType,
        start_date_calculation: startCalc,
        end_date_calculation: endCalcV,
        expected_payment_date: expectedPayment || toDateOnly(item?.paymentDate),
        source_period_start: beginPay,
        source_period_end: endPay,
        item_id: itemId,
        transaction_id: item?.transactionId ? String(item.transactionId) : null,
        type: item?.type ? String(item.type) : null,
        status: item?.status ? String(item.status) : null,
        sub_status: item?.subStatus ? String(item.subStatus) : null,
        payment_date: toDateOnly(item?.paymentDate),
        due_date: toDateOnly(item?.dueDate),
        installment: item?.installment ?? null,
        amount: normalizeNumber(item?.amount),
        net_value: normalizeNumber(item?.netValue ?? item?.transactionNetValue),
        fee_value: normalizeNumber(item?.feeValue ?? item?.fee ?? item?.totalFee),
        bank_name: accountDetails?.bankName ?? null,
        bank_code: accountDetails?.bankCode ?? accountDetails?.bank ?? null,
        branch_code: accountDetails?.branchCode ?? null,
        account_number: accountDetails?.accountNumber ?? null,
        account_digit: accountDetails?.accountDigit ?? null,
        document_number: item?.documentNumber ?? item?.document ?? null,
        raw,
        fetched_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
    });
  });

  if (rows.length > 0) {
    const uniqMap = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const k = `${r.merchant_id}|${r.settlement_id}|${r.item_id}`;
      uniqMap.set(k, r);
    }
    const dedupedRows = Array.from(uniqMap.values());
    const supabase = getSupabaseClient();
    const chunks = chunkArray(dedupedRows, 200);
    for (const chunk of chunks) {
      // Usar upsert ao invés de update/insert manual
      const { error: upsertErr } = await supabase
        .from('ifood_settlement_items')
        .upsert(chunk, {
          onConflict: 'merchant_id,settlement_id,item_id',
          ignoreDuplicates: false
        });
      if (upsertErr) throw new Error(`Erro ao fazer upsert de títulos: ${upsertErr.message}`);
    }
  }

  return {
    status: 200,
    body: {
      merchantId,
      accountId,
      beginPaymentDate: beginPay,
      endPaymentDate: endPay,
      settlementCount: settlements.length,
      processedItems: processed,
      diagnostics: { url: settlementsUrl, httpStatus: apiResponse.status, rawLength: rawText?.length || 0 },
    },
  };
}

const toDateOnly = (value: unknown): string | null => {
  if (!value) return null;
  try {
    const date = new Date(value as string);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const getSupabaseClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar configuradas para ingestão de repasses.');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

type SettlementResponse = {
  settlements?: Array<{
    id?: string;
    settlementId?: string;
    settlementType?: string;
    type?: string;
    startDateCalculation?: string;
    endDateCalculation?: string;
    expectedPaymentDate?: string;
    startDate?: string;
    endDate?: string;
    closingItems?: Array<any>;
  }>;
};

// Observação: a API requer beginCalculationDate/endCalculationDate (ou beginPaymentDate/endPaymentDate).
// Vamos usar SOMENTE beginCalculationDate/endCalculationDate conforme solicitado.
async function ingestSettlements({
  merchantId,
  accountId,
  beginCalc,
  endCalc,
  token,
  headers,
}: {
  merchantId: string;
  accountId: string | null;
  beginCalc: string; // inclusive
  endCalc: string;   // exclusivo
  token: string;
  headers: Record<string, string>;
}) {
  // token já está aplicado em headers.Authorization; esta linha evita lint de não utilizado
  void token;
  const qs = new URLSearchParams({
    beginCalculationDate: beginCalc,
    endCalculationDate: endCalc,
  });
  const settlementsUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${encodeURIComponent(merchantId)}/settlements?${qs.toString()}`;

  const apiResponse = await fetchWithRetry(settlementsUrl, {
    method: 'GET',
    headers,
  }, 3, 600);

  const rawText = await apiResponse.text();
  let settlementsPayload: SettlementResponse | null = null;
  try {
    settlementsPayload = rawText ? (JSON.parse(rawText) as SettlementResponse) : null;
  } catch {
    settlementsPayload = null;
  }

  if (!apiResponse.ok) {
    const reason = settlementsPayload && (settlementsPayload as any).message;
    console.error('[ingestSettlements] API iFood error', {
      status: apiResponse.status,
      merchantId,
      beginCalc,
      endCalc,
      reason,
      rawText: rawText?.substring(0, 500)
    });
    return {
      status: apiResponse.status,
      body: {
        error: 'Falha ao consultar settlements na API iFood.',
        details: reason || rawText,
        status: apiResponse.status,
        diagnostics: {
          url: settlementsUrl,
          beginCalc,
          endCalc,
          rawLength: rawText?.length || 0,
        },
      },
    };
  }

  const settlements = Array.isArray(settlementsPayload?.settlements) ? settlementsPayload!.settlements! : [];
  const nowIso = new Date().toISOString();
  let processed = 0;

  const rows = settlements.flatMap((settlement) => {
    const settlementId = String(settlement?.id || settlement?.settlementId || randomUUID());
    const settlementType = settlement?.settlementType || settlement?.type || null;
    const startCalc = toDateOnly(settlement?.startDateCalculation || settlement?.startDate) || beginCalc;
    const endCalcV = toDateOnly(settlement?.endDateCalculation || settlement?.endDate) || endCalc;
    const expectedPayment = toDateOnly(settlement?.expectedPaymentDate);
    const items = Array.isArray(settlement?.closingItems) ? settlement!.closingItems! : [];

    return items.map((item: any, index: number) => {
      processed += 1;
      const accountDetails = item?.accountDetails ?? {};
      const raw = {
        settlement,
        item,
      };

      const itemId = item?.id ? String(item.id) : `${settlementId}-${index}`;
      return {
        id: randomUUID(),
        merchant_id: merchantId,
        account_id: accountId || null,
        settlement_id: settlementId,
        settlement_type: settlementType,
        start_date_calculation: startCalc,
        end_date_calculation: endCalcV,
        expected_payment_date: expectedPayment || toDateOnly(item?.paymentDate),
        source_period_start: beginCalc,
        source_period_end: endCalc,
        item_id: itemId,
        transaction_id: item?.transactionId ? String(item.transactionId) : null,
        type: item?.type ? String(item.type) : null,
        status: item?.status ? String(item.status) : null,
        sub_status: item?.subStatus ? String(item.subStatus) : null,
        payment_date: toDateOnly(item?.paymentDate),
        due_date: toDateOnly(item?.dueDate),
        installment: item?.installment ?? null,
        amount: normalizeNumber(item?.amount),
        net_value: normalizeNumber(item?.netValue ?? item?.transactionNetValue),
        fee_value: normalizeNumber(item?.feeValue ?? item?.fee ?? item?.totalFee),
        bank_name: accountDetails?.bankName ?? null,
        bank_code: accountDetails?.bankCode ?? accountDetails?.bank ?? null,
        branch_code: accountDetails?.branchCode ?? null,
        account_number: accountDetails?.accountNumber ?? null,
        account_digit: accountDetails?.accountDigit ?? null,
        document_number: item?.documentNumber ?? item?.document ?? null,
        raw,
        fetched_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
    });
  });

  if (rows.length > 0) {
    // 0) Deduplicar dentro do próprio lote por chave única (merchant_id, settlement_id, item_id)
    const uniqMap = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const k = `${r.merchant_id}|${r.settlement_id}|${r.item_id}`;
      // Mantemos o último valor (idempotente para fins de upsert)
      uniqMap.set(k, r);
    }
    const dedupedRows = Array.from(uniqMap.values());
    const supabase = getSupabaseClient();
    // Usar upsert nativo do Supabase para evitar erros de constraint duplicada
    const chunks = chunkArray(dedupedRows, 200);
    for (const chunk of chunks) {
      const { error: upsertErr } = await supabase
        .from('ifood_settlement_items')
        .upsert(chunk, {
          onConflict: 'merchant_id,settlement_id,item_id',
          ignoreDuplicates: false
        });
      if (upsertErr) throw new Error(`Erro ao fazer upsert de títulos: ${upsertErr.message}`);
    }
  }

  return {
    status: 200,
    body: {
      merchantId,
      accountId,
      beginCalculationDate: beginCalc,
      endCalculationDate: endCalc,
      settlementCount: settlements.length,
      processedItems: processed,
      diagnostics: {
        url: settlementsUrl,
        httpStatus: apiResponse.status,
        rawLength: rawText?.length || 0,
      },
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', cors['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);
  if (req.method === 'OPTIONS') return res.status(200).send('ok');

  const traceId = Date.now().toString(36);
  res.setHeader('X-Trace-Id', traceId);

  try {
    const method = (req.method || 'GET').toUpperCase();

    let body: Record<string, any>;
    if (req.body == null) {
      body = {};
    } else if (typeof req.body === 'string') {
      try {
        body = req.body ? JSON.parse(req.body) : {};
      } catch (err) {
        return res.status(400).json({ error: 'Corpo da requisição inválido (JSON malformado).', traceId });
      }
    } else if (Buffer.isBuffer(req.body)) {
      try {
        const raw = req.body.toString('utf-8');
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        return res.status(400).json({ error: 'Corpo da requisição inválido (buffer JSON malformado).', traceId });
      }
    } else {
      body = req.body as Record<string, any>;
    }

    console.debug('[ifood-settlements] incoming request', { method, traceId, hasBody: Object.keys(body || {}).length > 0 });

    // Auth header: aceita x-ifood-token ou Authorization: Bearer ou campo accessToken no corpo (para POST ingest)
    const tokenHeader = (req.headers['x-ifood-token'] || req.headers['authorization'] || '') as string;
    const bodyToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
    const rawToken = tokenHeader || bodyToken;
    const token = rawToken?.toLowerCase().startsWith('bearer ')
      ? rawToken.slice(7)
      : rawToken;
    if (!token) return res.status(401).json({ error: 'Token de autenticação não fornecido.', traceId });

    const url = new URL(req.url || '/', 'https://local');
    const merchantIdQuery = (url.searchParams.get('merchantId') || '').trim();
    const merchantIdBody = typeof body?.merchantId === 'string' ? body.merchantId.trim() : '';
    const merchantId = merchantIdBody || merchantIdQuery;
    if (!merchantId) return res.status(400).json({ error: 'O parâmetro merchantId é obrigatório.', traceId });

    const ingestFlag = body?.ingest;
    const ingestMode = method === 'POST' && (ingestFlag === true || ingestFlag === 'true' || ingestFlag === 1 || body?.mode === 'ingest');
    console.debug('[ifood-settlements] ingest check', { traceId, ingestFlag, ingestMode, merchantId, hasBegin: !!body?.beginPaymentDate, hasEnd: !!body?.endPaymentDate });

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const homoHeader = (req.headers['x-request-homologation'] || '').toString().trim().toLowerCase();
    // Também aceita via query param isHomologation=true/1
    const urlTmp = new URL(req.url || '/', 'https://local');
    const homoQuery = (urlTmp.searchParams.get('isHomologation') || '').toString().trim().toLowerCase();
    if (homoHeader === 'true' || homoHeader === '1' || homoQuery === 'true' || homoQuery === '1') {
      headers['x-request-homologation'] = 'true';
    }

    if (ingestMode) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const accountId = body?.accountId ? String(body.accountId) : null;

      // Modo full year (MÊS A MÊS): buscamos por datas de CÁLCULO e também por datas de PAGAMENTO
      const fullYear = body?.fullYear === true || body?.fullYear === 'true' || body?.fullYear === 1;
      const year = Number(body?.year || new Date().getFullYear());
      const throughMonthRaw = body?.throughMonth != null ? Number(body.throughMonth) : null; // 1..12
      if (fullYear && year > 1900) {
        const windows: Array<{ b: string; e: string }> = [];
        const now = new Date();
        const isCurrentYear = year === now.getUTCFullYear();
        let lastMonthIndexInclusive = isCurrentYear ? now.getUTCMonth() : 11; // 0..current
        if (throughMonthRaw && throughMonthRaw >= 1 && throughMonthRaw <= 12) {
          lastMonthIndexInclusive = Math.max(0, Math.min(11, throughMonthRaw - 1));
        }
        for (let m = 0; m <= lastMonthIndexInclusive; m++) {
          const bDate = new Date(Date.UTC(year, m, 1));
          const eDate = new Date(Date.UTC(year, m + 1, 1)); // 1º dia do mês seguinte (fim exclusivo)
          const b = bDate.toISOString().slice(0, 10);
          const e = eDate.toISOString().slice(0, 10);
          windows.push({ b, e });
        }

        let totalProcessed = 0;
        let totalSettlements = 0;
        const details: Array<{ begin: string; end: string; processedItems: number; settlementCount: number; type: 'calc' | 'payment' }> = [];
        for (const [idx, w] of windows.entries()) {
          const { status, body: responseBody } = await ingestSettlements({
            merchantId,
            accountId,
            beginCalc: w.b,
            endCalc: w.e,
            token,
            headers,
          });
          if (status >= 400) {
            return res.status(status).json({ ...responseBody, window: { ...w, index: idx + 1 } });
          }
          totalProcessed += Number(responseBody?.processedItems || 0);
          totalSettlements += Number(responseBody?.settlementCount || 0);
          details.push({
            begin: w.b,
            end: w.e,
            processedItems: Number(responseBody?.processedItems || 0),
            settlementCount: Number(responseBody?.settlementCount || 0),
            type: 'calc',
            httpStatus: Number((responseBody as any)?.diagnostics?.httpStatus || 200),
            rawLength: Number((responseBody as any)?.diagnostics?.rawLength || 0),
            index: idx + 1,
          } as any);
          // Delay curto entre janelas para respeitar limites do iFood
          if (WINDOW_DELAY_MS > 0) await sleep(WINDOW_DELAY_MS);

          // Complemento: janela por DATA DE PAGAMENTO do mesmo mês
          const { status: pStatus, body: pBody } = await ingestSettlementsByPayment({
            merchantId,
            accountId,
            beginPay: w.b,
            endPay: w.e,
            token,
            headers,
          });
          if (pStatus >= 400) {
            return res.status(pStatus).json({ ...pBody, window: { ...w, index: idx + 1, type: 'payment' } });
          }
          totalProcessed += Number((pBody as any)?.processedItems || 0);
          totalSettlements += Number((pBody as any)?.settlementCount || 0);
          details.push({
            begin: w.b,
            end: w.e,
            processedItems: Number((pBody as any)?.processedItems || 0),
            settlementCount: Number((pBody as any)?.settlementCount || 0),
            type: 'payment',
            httpStatus: Number((pBody as any)?.diagnostics?.httpStatus || 200),
            rawLength: Number((pBody as any)?.diagnostics?.rawLength || 0),
            index: idx + 1,
          } as any);
          if (WINDOW_DELAY_MS > 0) await sleep(WINDOW_DELAY_MS);
        }
        return res.status(200).json({ merchantId, accountId, year, windows: windows.length, processedItems: totalProcessed, settlementCount: totalSettlements, details });
      }

      // Janela única: permitir cálculo OU pagamento
      const preferPayment = body?.preferPayment === true || body?.preferPayment === 'true' || body?.preferPayment === 1;
      const hasPaymentBounds = !!body?.beginPaymentDate || !!body?.endPaymentDate;
      if (preferPayment || hasPaymentBounds) {
        const beginPaymentDate = toDateOnly(body?.beginPaymentDate) || todayIso;
        const tmpPayEnd = body?.endPaymentDate ? toDateOnly(body?.endPaymentDate) : null;
        let endPaymentDate = tmpPayEnd;
        if (!endPaymentDate) {
          const d = new Date(`${beginPaymentDate}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 30);
          endPaymentDate = d.toISOString().slice(0, 10);
        }
        const { status, body: pBody } = await ingestSettlementsByPayment({
          merchantId,
          accountId,
          beginPay: beginPaymentDate!,
          endPay: endPaymentDate!,
          token,
          headers,
        });
        return res.status(status).json(pBody);
      } else {
        const beginCalculationDate = toDateOnly(body?.beginCalculationDate) || todayIso;
        const tmpEnd = body?.endCalculationDate ? toDateOnly(body?.endCalculationDate) : null;
        let endCalculationDate = tmpEnd;
        if (!endCalculationDate) {
          const d = new Date(`${beginCalculationDate}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 30);
          endCalculationDate = d.toISOString().slice(0, 10);
        }
        const { status, body: responseBody } = await ingestSettlements({
          merchantId,
          accountId,
          beginCalc: beginCalculationDate!,
          endCalc: endCalculationDate!,
          token,
          headers,
        });
        return res.status(status).json(responseBody);
      }
    }

    // GET e POST pass-through padrão
    const beginPaymentDate = (url.searchParams.get('beginPaymentDate') || url.searchParams.get('beginSettlementDate') || '').trim();
    const endPaymentDate = (url.searchParams.get('endPaymentDate') || url.searchParams.get('endSettlementDate') || '').trim();
    if (!beginPaymentDate || !endPaymentDate) {
      return res.status(400).json({ error: 'Parâmetros beginPaymentDate e endPaymentDate são obrigatórios (aceitamos beginSettlementDate/endSettlementDate como fallback).', traceId });
    }

    const qs = new URLSearchParams();
    qs.set('beginPaymentDate', beginPaymentDate);
    qs.set('endPaymentDate', endPaymentDate);
    url.searchParams.forEach((v, k) => {
      if (!['merchantId', 'beginSettlementDate', 'endSettlementDate', 'beginPaymentDate', 'endPaymentDate'].includes(k)) {
        qs.set(k, v);
      }
    });
    // Preserve isHomologation param if present
    const isHomo = url.searchParams.get('isHomologation');
    if (isHomo != null && isHomo !== '') qs.set('isHomologation', isHomo);

    const iFoodUrl = `${IFOOD_BASE_URL}/financial/v3.0/merchants/${merchantId}/settlements?${qs.toString()}`;

    const options: RequestInit = {
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' && method !== 'HEAD' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})) : undefined,
    };

    const apiResponse = await fetch(iFoodUrl, options as any);
    const responseText = await apiResponse.text();

    res.status(apiResponse.status);
    const ct = apiResponse.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    const cacheCtl = apiResponse.headers.get('cache-control');
    if (cacheCtl) res.setHeader('Cache-Control', cacheCtl);
    const pragma = apiResponse.headers.get('pragma');
    if (pragma) res.setHeader('Pragma', pragma);
    const expires = apiResponse.headers.get('expires');
    if (expires) res.setHeader('Expires', expires);
    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('X-Proxy-Target-Url', iFoodUrl);
    return res.send(responseText);
  } catch (e: any) {
    console.error('[ifood-settlements] error', { 
      traceId, 
      error: e?.message || String(e),
      stack: e?.stack,
      merchantId: req.query?.merchantId || req.body?.merchantId,
      method: req.method,
      body: req.body,
      url: req.url
    });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ 
      error: 'Erro interno no servidor: proxy.', 
      details: e?.message || String(e),
      stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined,
      hint: 'Verifique se o token está válido e se o merchantId está correto',
      traceId,
      requestInfo: {
        method: req.method,
        merchantId: req.query?.merchantId || req.body?.merchantId,
        hasToken: !!(req.headers['x-ifood-token'] || req.headers['authorization'] || req.body?.accessToken),
        bodyKeys: req.body ? Object.keys(req.body) : []
      }
    });
  }
}
