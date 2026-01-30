import { createServiceSupabaseClient, requireAdminUser } from './_shared/admin-auth';

function asString(v: any): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

function asBoolean(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = asString(v).trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return null;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'PATCH') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const admin = await requireAdminUser(req);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const accountId = asString(
      req.params?.accountId ??
        req.query?.accountId ??
        req.query?.id ??
        req.query?.account_id
    ).trim();
    const isActive = asBoolean(req.body?.is_active ?? req.body?.isActive);
    const reasonCode = asString(req.body?.reason_code ?? req.body?.reasonCode).trim();
    const reasonDetail = asString(req.body?.reason_detail ?? req.body?.reasonDetail).trim();

    if (!accountId) {
      res.status(400).json({ error: 'missing_account_id' });
      return;
    }
    if (isActive === null) {
      res.status(400).json({ error: 'missing_is_active' });
      return;
    }

    if (isActive === false && !reasonCode) {
      res.status(400).json({ error: 'missing_reason_code' });
      return;
    }

    const supabase = createServiceSupabaseClient();

    const { data: existing, error: getErr } = await supabase
      .from('accounts')
      .select('id, agency_id, is_active')
      .eq('id', accountId)
      .single();

    if (getErr) {
      res.status(500).json({ error: 'query_failed', message: getErr.message });
      return;
    }

    const nowIso = new Date().toISOString();

    const updatePayload: any = { is_active: isActive };
    if (isActive === false) {
      updatePayload.deactivated_reason_code = reasonCode;
      updatePayload.deactivated_reason_detail = reasonDetail || null;
      updatePayload.deactivated_at = nowIso;
      updatePayload.deactivated_by = admin.userId;
    } else {
      updatePayload.deactivated_reason_code = null;
      updatePayload.deactivated_reason_detail = null;
      updatePayload.deactivated_at = null;
      updatePayload.deactivated_by = null;
    }

    const { data: updated, error: updErr } = await supabase
      .from('accounts')
      .update(updatePayload)
      .eq('id', accountId)
      .select('id, is_active, deactivated_reason_code, deactivated_reason_detail, deactivated_at, deactivated_by')
      .single();

    if (updErr) {
      res.status(500).json({ error: 'update_failed', message: updErr.message });
      return;
    }

    const eventPayload: any = {
      account_id: accountId,
      agency_id: (existing as any)?.agency_id ?? null,
      actor_user_id: admin.userId,
      actor_role: 'admin',
      action: isActive ? 'activate' : 'deactivate',
      reason_code: isActive ? null : reasonCode,
      reason_detail: isActive ? null : (reasonDetail || null),
    };

    const { error: evErr } = await supabase.from('account_status_events').insert(eventPayload);
    if (evErr) {
      res.status(500).json({ error: 'event_insert_failed', message: evErr.message });
      return;
    }

    res.status(200).json({ data: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
}
