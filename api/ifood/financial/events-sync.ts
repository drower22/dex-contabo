import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { decryptFromB64 } from '../../_shared/crypto';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const IFOOD_BASE_URL = (process.env.IFOOD_BASE_URL || process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br').trim();
const IFOOD_PROXY_BASE = process.env.IFOOD_PROXY_BASE?.trim();
const IFOOD_PROXY_KEY = process.env.IFOOD_PROXY_KEY?.trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function resolveMerchantId(accountId: string): Promise<string | null> {
  const { data: authStoreFinancial } = await supabase
    .from('ifood_store_auth')
    .select('ifood_merchant_id')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromAuthFinancial = (authStoreFinancial as any)?.ifood_merchant_id;
  if (typeof fromAuthFinancial === 'string' && fromAuthFinancial.trim()) return fromAuthFinancial.trim();

  const { data: authStoreAny } = await supabase
    .from('ifood_store_auth')
    .select('ifood_merchant_id')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromAuthAny = (authStoreAny as any)?.ifood_merchant_id;
  if (typeof fromAuthAny === 'string' && fromAuthAny.trim()) return fromAuthAny.trim();

  const { data: account } = await supabase
    .from('accounts')
    .select('ifood_merchant_id')
    .eq('id', accountId)
    .maybeSingle();

  const fromAccounts = (account as any)?.ifood_merchant_id;
  return typeof fromAccounts === 'string' && fromAccounts.trim() ? fromAccounts.trim() : null;
}

async function resolveAccessToken(accountId: string): Promise<string | null> {
  const { data: auth } = await supabase
    .from('ifood_store_auth')
    .select('access_token')
    .eq('account_id', accountId)
    .eq('scope', 'financial')
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = (auth as any)?.access_token;
  if (!raw || typeof raw !== 'string') return null;

  try {
    const decrypted = await decryptFromB64(raw);
    return decrypted || raw;
  } catch {
    return raw;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function toNumberSafe(v: any): number | null {
  const n = typeof v === 'number' ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s.slice(0, 10);
}

async function fetchFinancialEventsPage(params: {
  accessToken: string;
  merchantId: string;
  beginDate: string;
  endDate: string;
  page: number;
  size: number;
}): Promise<{ ok: boolean; status: number; bodyText: string; json: any | null }> {
  const qs = new URLSearchParams({
    beginDate: params.beginDate,
    endDate: params.endDate,
    page: String(params.page),
    size: String(params.size),
  }).toString();

  const path = `/financial/v3.0/merchants/${encodeURIComponent(params.merchantId)}/financial-events?${qs}`;

  let url: string;
  let headers: Record<string, string>;

  if (IFOOD_PROXY_BASE && IFOOD_PROXY_KEY) {
    url = `${IFOOD_PROXY_BASE}?path=${encodeURIComponent(path)}`;
    headers = {
      'x-shared-key': IFOOD_PROXY_KEY,
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    };
  } else {
    url = `${IFOOD_BASE_URL}${path}`;
    headers = {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    };
  }

  const resp = await fetch(url, { method: 'GET', headers });
  const bodyText = await resp.text();

  let json: any = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  return { ok: resp.ok, status: resp.status, bodyText, json };
}

export async function syncIfoodFinancialEvents(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      accountId: accountIdRaw,
      storeId,
      merchantId: merchantIdRaw,
      beginDate: beginDateRaw,
      endDate: endDateRaw,
      periodStart,
      periodEnd,
      syncMode,
    } = (req.body || {}) as any;

    const accountId = String(accountIdRaw || storeId || '').trim();
    const merchantIdInput = String(merchantIdRaw || '').trim();

    const beginDate = String(beginDateRaw || periodStart || '').trim();
    const endDate = String(endDateRaw || periodEnd || '').trim();

    if (!accountId) {
      return res.status(400).json({ error: 'Parâmetro obrigatório: accountId' });
    }

    if (!beginDate || !endDate) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios: beginDate e endDate (YYYY-MM-DD)' });
    }

    const normalizedMode = syncMode === 'backfill' || syncMode === 'incremental' ? syncMode : 'backfill';

    const accessToken = await resolveAccessToken(accountId);
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token found', message: 'Financial scope not authorized for this account' });
    }

    const merchantId = merchantIdInput || (await resolveMerchantId(accountId));
    if (!merchantId) {
      return res.status(404).json({ error: 'Merchant ID not found for this account' });
    }

    const nowIso = new Date().toISOString();

    try {
      await supabase
        .from('ifood_financial_events_sync_status')
        .upsert(
          {
            account_id: accountId,
            merchant_id: merchantId,
            period_start: beginDate,
            period_end: endDate,
            status: 'in_progress',
            started_at: nowIso,
            completed_at: null,
            last_error: null,
            total_events: 0,
            total_pages: 0,
          },
          { onConflict: 'account_id,merchant_id,period_start,period_end' },
        );
    } catch {
    }

    const size = 100;
    let page = 1;
    let totalPages = 0;
    let totalEvents = 0;

    const rowsToUpsert: any[] = [];

    for (;;) {
      const result = await fetchFinancialEventsPage({
        accessToken,
        merchantId,
        beginDate,
        endDate,
        page,
        size,
      });

      if (!result.ok) {
        const errorMessage = `HTTP ${result.status}: ${String(result.bodyText || '').slice(0, 500)}`;
        try {
          await supabase
            .from('ifood_financial_events_sync_status')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              last_error: errorMessage,
              total_events: totalEvents,
              total_pages: totalPages,
            })
            .eq('account_id', accountId)
            .eq('merchant_id', merchantId)
            .eq('period_start', beginDate)
            .eq('period_end', endDate);
        } catch {
        }

        return res.status(result.status >= 400 && result.status < 600 ? result.status : 500).json({
          error: 'iFood API error',
          status: result.status,
          body: result.json ?? result.bodyText,
        });
      }

      totalPages += 1;

      const payload = result.json || {};
      const events = Array.isArray(payload.financialEvents) ? payload.financialEvents : [];

      for (const ev of events) {
        const stableKey = {
          merchantId,
          competence: ev?.competence ?? null,
          period: ev?.period ?? null,
          reference: ev?.reference ?? null,
          name: ev?.name ?? null,
          description: ev?.description ?? null,
          product: ev?.product ?? null,
          trigger: ev?.trigger ?? null,
          hasTransferImpact: ev?.hasTransferImpact ?? null,
          amount: ev?.amount ?? null,
          billing: ev?.billing ?? null,
          settlement: ev?.settlement ?? null,
          receiver: ev?.receiver ?? null,
          payment: ev?.payment ?? null,
        };

        const eventKey = sha256Hex(JSON.stringify(stableKey));

        rowsToUpsert.push({
          event_key: eventKey,
          account_id: accountId,
          merchant_id: merchantId,
          competence: typeof ev?.competence === 'string' ? ev.competence : null,
          period_begin_date: toDateOnly(ev?.period?.beginDate),
          period_end_date: toDateOnly(ev?.period?.endDate),
          balance_id: typeof ev?.period?.idSaldo === 'string' ? ev.period.idSaldo : null,
          reference_type: typeof ev?.reference?.type === 'string' ? ev.reference.type : null,
          reference_id: typeof ev?.reference?.id === 'string' ? ev.reference.id : null,
          reference_date: typeof ev?.reference?.date === 'string' ? ev.reference.date : null,
          name: typeof ev?.name === 'string' ? ev.name : null,
          description: typeof ev?.description === 'string' ? ev.description : null,
          product: typeof ev?.product === 'string' ? ev.product : null,
          trigger: typeof ev?.trigger === 'string' ? ev.trigger : null,
          has_transfer_impact: typeof ev?.hasTransferImpact === 'boolean' ? ev.hasTransferImpact : null,
          amount_value: toNumberSafe(ev?.amount?.value),
          billing_base_value: toNumberSafe(ev?.billing?.baseValue),
          fee_percentage: toNumberSafe(ev?.billing?.feePercentage),
          expected_settlement_date: toDateOnly(ev?.settlement?.expectedDate),
          receiver_merchant_id: typeof ev?.receiver?.merchantId === 'string' ? ev.receiver.merchantId : null,
          receiver_merchant_document: typeof ev?.receiver?.merchantDocument === 'string' ? ev.receiver.merchantDocument : null,
          payment_method: typeof ev?.payment?.method === 'string' ? ev.payment.method : null,
          payment_brand: typeof ev?.payment?.brand === 'string' ? ev.payment.brand : null,
          payment_liability: typeof ev?.payment?.liability === 'string' ? ev.payment.liability : null,
          raw: ev,
          synced_at: new Date().toISOString(),
        });
      }

      totalEvents += events.length;

      const hasNextPage = Boolean(payload.hasNextPage);

      if (!hasNextPage) {
        break;
      }

      page += 1;
      if (page >= 2000) {
        break;
      }
    }

    if (rowsToUpsert.length === 0) {
      try {
        await supabase
          .from('ifood_financial_events_sync_status')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_events: 0,
            total_pages: totalPages,
            last_error: null,
          })
          .eq('account_id', accountId)
          .eq('merchant_id', merchantId)
          .eq('period_start', beginDate)
          .eq('period_end', endDate);
      } catch {
      }

      return res.status(200).json({
        success: true,
        message: 'Sincronização concluída (nenhum evento retornado pela API)',
        data: {
          eventsSynced: 0,
          totalPages,
          beginDate,
          endDate,
        },
      });
    }

    const shouldDelete = normalizedMode === 'backfill';

    if (shouldDelete) {
      const { error: deleteError } = await supabase
        .from('ifood_financial_events')
        .delete()
        .eq('account_id', accountId)
        .eq('merchant_id', merchantId)
        .gte('period_begin_date', beginDate)
        .lte('period_end_date', endDate);

      if (deleteError) {
        throw new Error(`Erro ao limpar eventos existentes no período: ${deleteError.message}`);
      }
    }

    const batchSize = 500;
    let saved = 0;

    for (let i = 0; i < rowsToUpsert.length; i += batchSize) {
      const batch = rowsToUpsert.slice(i, i + batchSize);
      const { error, count } = await supabase
        .from('ifood_financial_events')
        .upsert(batch, { onConflict: 'event_key', ignoreDuplicates: false, count: 'exact' });

      if (error) {
        throw new Error(`Erro ao salvar eventos no banco: ${error.message}`);
      }

      saved += count ?? batch.length;
    }

    try {
      await supabase
        .from('ifood_financial_events_sync_status')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_events: saved,
          total_pages: totalPages,
          last_error: null,
        })
        .eq('account_id', accountId)
        .eq('merchant_id', merchantId)
        .eq('period_start', beginDate)
        .eq('period_end', endDate);
    } catch {
    }

    return res.status(200).json({
      success: true,
      message: 'Sincronização concluída',
      data: {
        eventsSynced: saved,
        totalPages,
        beginDate,
        endDate,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Erro ao sincronizar eventos financeiros',
      message: error?.message || String(error),
    });
  }
}
