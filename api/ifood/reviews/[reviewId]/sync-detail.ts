import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getIfoodToken(accountId: string, traceId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'reviews' },
  });

  if (error || !data?.access_token) {
    console.error('[reviews-sync-detail] token error', {
      trace_id: traceId,
      accountId,
      error: (error as any)?.message ?? error,
    });
    throw new Error('Erro ao obter token do iFood');
  }

  return data.access_token as string;
}

async function fetchReviewDetail(args: {
  token: string;
  merchantId: string;
  reviewId: string;
  traceId: string;
}): Promise<any> {
  const ifoodPath = `/review/v2.0/merchants/${args.merchantId}/reviews/${args.reviewId}`;

  if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
    const proxyUrl = new URL(IFOOD_PROXY_BASE);
    proxyUrl.searchParams.set('path', ifoodPath);

    const resp = await fetch(proxyUrl.toString(), {
      method: 'GET',
      headers: {
        'x-shared-key': IFOOD_PROXY_KEY,
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/json',
      },
    });

    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Erro ao buscar review detail: ${resp.status} ${text?.slice(0, 300)}`);
    }

    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  const url = `${IFOOD_BASE_URL}${ifoodPath}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: 'application/json',
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Erro ao buscar review detail: ${resp.status} ${text?.slice(0, 300)}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const reviewId = String((req.params as any)?.reviewId || '').trim();

    const { accountId: rawAccountId, storeId, merchantId, rateLimitMs } = req.body || {};
    const accountId = rawAccountId || storeId;

    if (!reviewId || !accountId || !merchantId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'reviewId (path), accountId (ou storeId) e merchantId são obrigatórios',
        trace_id: traceId,
      });
    }

    const minDelayMs = Math.max(0, Number(rateLimitMs ?? 0));
    if (minDelayMs > 0) await sleep(minDelayMs);

    const token = await getIfoodToken(String(accountId), traceId);
    const detail = await fetchReviewDetail({
      token,
      merchantId: String(merchantId),
      reviewId,
      traceId,
    });

    const customerName = detail?.customerName ?? detail?.customer?.name ?? null;

    const { error } = await supabase
      .from('ifood_review_details')
      .upsert(
        {
          review_id: reviewId,
          account_id: String(accountId),
          merchant_id: String(merchantId),
          customer_name: customerName,
          raw: detail ?? {},
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'review_id' }
      );

    if (error) {
      console.error('[reviews-sync-detail] upsert error', {
        trace_id: traceId,
        message: (error as any).message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });
      throw new Error('Erro ao salvar review detail no banco');
    }

    return res.status(200).json({
      success: true,
      trace_id: traceId,
      reviewId,
      customer_name: customerName,
      has_questions: Array.isArray(detail?.questions) && detail.questions.length > 0,
    });
  } catch (e: any) {
    console.error('[reviews-sync-detail] error', { trace_id: traceId, message: e?.message || String(e) });
    return res.status(500).json({
      error: 'reviews_sync_detail_failed',
      message: e?.message || String(e),
      trace_id: traceId,
    });
  }
}
