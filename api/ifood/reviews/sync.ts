import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type SyncMode = 'backfill' | 'incremental';

async function getIfoodToken(accountId: string, traceId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ifood-get-token', {
    body: { storeId: accountId, scope: 'reviews' },
  });

  if (error || !data?.access_token) {
    console.error('[reviews-sync] token error', { trace_id: traceId, accountId, error: (error as any)?.message ?? error });
    throw new Error('Erro ao obter token do iFood');
  }

  return data.access_token as string;
}

function computeDateRange(input: {
  from?: string;
  to?: string;
  days?: number;
}): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const toDate = input.to ? new Date(input.to) : now;
  const fromDate = input.from
    ? new Date(input.from)
    : new Date(toDate.getTime() - (Number(input.days || 30) * 24 * 60 * 60 * 1000));

  return {
    dateFrom: fromDate.toISOString(),
    dateTo: toDate.toISOString(),
  };
}

async function fetchReviewsPage(args: {
  token: string;
  merchantId: string;
  page: number;
  pageSize: number;
  dateFrom: string;
  dateTo: string;
  traceId: string;
}): Promise<any> {
  const params = new URLSearchParams({
    page: String(args.page),
    pageSize: String(args.pageSize),
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    sort: 'DESC',
    sortBy: 'CREATED_AT',
  });

  const ifoodPath = `/review/v2.0/merchants/${args.merchantId}/reviews?${params.toString()}`;

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
      throw new Error(`Erro ao buscar reviews: ${resp.status} ${text?.slice(0, 300)}`);
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
    throw new Error(`Erro ao buscar reviews: ${resp.status} ${text?.slice(0, 300)}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function upsertReviews(records: any[], traceId: string): Promise<number> {
  if (!records.length) return 0;

  const batchSize = 200;
  let total = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error, count } = await supabase
      .from('ifood_reviews')
      .upsert(batch, {
        onConflict: 'account_id,merchant_id,review_id',
        ignoreDuplicates: false,
        count: 'exact',
      });

    if (error) {
      console.error('[reviews-sync] upsert error', { trace_id: traceId, message: (error as any).message, details: (error as any).details, hint: (error as any).hint, code: (error as any).code });
      throw new Error('Erro ao salvar reviews no banco');
    }

    total += count ?? batch.length;
  }

  return total;
}

export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      accountId: rawAccountId,
      storeId,
      merchantId,
      mode,
      days,
      from,
      to,
    } = req.body || {};

    const accountId = rawAccountId || storeId;

    if (!accountId || !merchantId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'accountId (ou storeId) e merchantId são obrigatórios',
        trace_id: traceId,
      });
    }

    const syncMode: SyncMode = (mode === 'incremental' ? 'incremental' : 'backfill');

    let dateFrom: string;
    let dateTo: string;

    if (syncMode === 'incremental') {
      const { data: lastRow } = await supabase
        .from('ifood_reviews')
        .select('created_at')
        .eq('account_id', accountId)
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastCreatedAt = lastRow?.created_at ? new Date(String(lastRow.created_at)) : null;
      const overlapDays = 2;
      const effectiveFrom = lastCreatedAt
        ? new Date(lastCreatedAt.getTime() - overlapDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      const range = computeDateRange({ from: effectiveFrom, to, days: Number(days || 30) });
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    } else {
      const range = computeDateRange({ from, to, days: Number(days || 30) });
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    const token = await getIfoodToken(String(accountId), traceId);

    const pageSize = 50;
    const maxPages = 200;

    let page = 1;
    let totalFetched = 0;
    const rawReviews: any[] = [];

    while (page <= maxPages) {
      const data = await fetchReviewsPage({
        token,
        merchantId: String(merchantId),
        page,
        pageSize,
        dateFrom,
        dateTo,
        traceId,
      });

      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) break;

      rawReviews.push(...reviews);
      totalFetched += reviews.length;

      const pageCount = Number(data?.pageCount);
      if (!Number.isNaN(pageCount) && pageCount > 0) {
        if (page >= pageCount) break;
      }

      page += 1;
    }

    const nowIso = new Date().toISOString();

    const records = rawReviews.map((r: any) => ({
      account_id: String(accountId),
      merchant_id: String(merchantId),
      review_id: String(r.id),
      created_at: r.createdAt ?? null,
      score: typeof r.score === 'number' ? r.score : r.score ?? null,
      status: r.status ?? null,
      visibility: r.visibility ?? null,
      comment: r.comment ?? null,
      synced_at: nowIso,
    }));

    const saved = await upsertReviews(records, traceId);

    return res.status(200).json({
      success: true,
      trace_id: traceId,
      mode: syncMode,
      accountId,
      merchantId,
      date_range: { dateFrom, dateTo },
      fetched: totalFetched,
      saved,
      pages: page - 1,
    });
  } catch (e: any) {
    console.error('[reviews-sync] error', { trace_id: traceId, message: e?.message || String(e) });
    return res.status(500).json({
      error: 'reviews_sync_failed',
      message: e?.message || String(e),
      trace_id: traceId,
    });
  }
}
