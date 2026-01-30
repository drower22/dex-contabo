import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function clampReport(text: string): string {
  return (text || '').trim();
}

function getBearerToken(headerValue: unknown): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function formatPtBrDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default async function handler(req: Request, res: Response) {
  const traceId = randomUUID();
  res.setHeader('X-Trace-Id', traceId);

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed', trace_id: traceId });
    }

    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured', trace_id: traceId });
    }

    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured', trace_id: traceId });
    }

    const token = getBearerToken(req.headers?.authorization ?? (req.headers as any)?.Authorization);
    if (!token) {
      return res.status(401).json({ error: 'missing_bearer_token', trace_id: traceId });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user?.id) {
      return res.status(401).json({ error: 'invalid_token', trace_id: traceId });
    }

    const userId = String(authData.user.id);
    const { data: agencyUser, error: roleErr } = await supabase
      .from('agency_users')
      .select('role, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (roleErr) {
      return res.status(500).json({ error: 'role_lookup_failed', message: roleErr.message, trace_id: traceId });
    }

    const role = (agencyUser as any)?.role ?? null;
    const isActive = (agencyUser as any)?.is_active ?? true;
    if (!isActive || !role || role === 'client_user') {
      return res.status(403).json({ error: 'forbidden', trace_id: traceId });
    }

    const { accountId, fromIso, periodLabel, storeName } = req.body || {};
    if (!accountId) {
      return res.status(400).json({ error: 'missing_required_params', message: 'accountId é obrigatório', trace_id: traceId });
    }

    let q = supabase
      .from('store_adjustments')
      .select('id, created_at, created_by, what_was_done, why_was_done, expected_results')
      .eq('account_id', String(accountId))
      .order('created_at', { ascending: true });

    if (typeof fromIso === 'string' && fromIso.trim()) {
      q = q.gte('created_at', fromIso.trim());
    }

    const { data: rows, error: dbErr } = await q;
    if (dbErr) {
      return res.status(500).json({ error: 'db_read_failed', message: dbErr.message, trace_id: traceId });
    }

    const adjustments = (rows ?? []) as any[];

    const createdByIds = Array.from(
      new Set(
        adjustments
          .map((a) => (typeof a?.created_by === 'string' ? a.created_by.trim() : ''))
          .filter(Boolean)
      )
    );

    const nameByAuthId = new Map<string, string>();
    if (createdByIds.length > 0) {
      try {
        const { data: usersData, error: usersErr } = await supabase
          .from('users')
          .select('auth_user_id, user_name, email')
          .in('auth_user_id', createdByIds);

        if (usersErr) {
          console.warn('[ai/store-adjustments-report] users lookup failed', {
            trace_id: traceId,
            message: usersErr.message,
          });
        } else {
          for (const u of usersData ?? []) {
            const id = typeof (u as any)?.auth_user_id === 'string' ? (u as any).auth_user_id.trim() : '';
            if (!id) continue;
            const display = String((u as any)?.user_name || (u as any)?.email || '').trim();
            if (display) nameByAuthId.set(id, display);
          }
        }
      } catch (e: any) {
        console.warn('[ai/store-adjustments-report] users lookup threw', {
          trace_id: traceId,
          message: e?.message || String(e),
        });
      }
    }

    const safeStoreName = typeof storeName === 'string' ? storeName.trim() : '';
    const safePeriodLabel = typeof periodLabel === 'string' ? periodLabel.trim() : '';

    const listText = adjustments
      .map((a) => {
        const createdAtIso = a?.created_at ? String(a.created_at) : '';
        const dt = createdAtIso ? formatPtBrDateTime(createdAtIso) : '';
        const createdBy = typeof a?.created_by === 'string' ? a.created_by.trim() : '';
        const who = createdBy ? (nameByAuthId.get(createdBy) || `Usuário ${createdBy.slice(0, 8)}`) : '';
        const what = String(a?.what_was_done ?? '').trim();
        const exp = String(a?.expected_results ?? '').trim();
        return [
          `- Data: ${dt}`,
          who ? `  - Responsável: ${who}` : null,
          what ? `  - O que foi feito: ${what}` : null,
          exp ? `  - Resultado esperado/objetivo: ${exp}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    const system = [
      'Você é um assistente especializado em gerar relatórios profissionais e claros para clientes finais (pt-BR).',
      'Você receberá uma lista de ajustes realizados em uma loja e deve produzir um relatório em Markdown, pronto para ser enviado ao cliente.',
      'Regras obrigatórias:',
      '- Idioma: pt-BR.',
      '- Não use emojis.',
      '- Não invente dados, números ou resultados. Use apenas o que estiver no material fornecido.',
      '- Seja objetivo, porém amigável e fácil de ler por um cliente.',
      '- O cliente não precisa de justificativas internas. NÃO explique "porquês"; foque em comunicar o que foi feito e transmitir a sensação de acompanhamento e trabalho contínuo.',
      '- Evite termos técnicos e detalhes operacionais internos. Use linguagem clara.',
      '- Quando houver muitos itens repetidos, agrupe por tema.',
      '- Se não houver ajustes no período, retorne um relatório curto explicando que não houve registros.',
      '- Inclua datas e horários em formato brasileiro (dd/mm/aaaa hh:mm:ss) sempre que estiverem disponíveis.',
      '',
      'Estrutura do Markdown:',
      '# Relatório de Ajustes',
      '## Período',
      '## Resumo do período (3 a 6 bullets)',
      '## Linha do tempo (detalhada)',
      '- Liste cada ajuste individualmente com: data/hora, responsável (se houver), o que foi feito e objetivo/resultado esperado.',
      '- Use subtítulos (###) por ajuste para facilitar leitura.',
      '## Próximos passos (curto e genérico, sem promessas e sem números)',
    ].join('\n');

    const user = [
      safeStoreName ? `Loja: ${safeStoreName}` : null,
      safePeriodLabel ? `Período selecionado: ${safePeriodLabel}` : null,
      `Total de ajustes: ${adjustments.length}`,
      'Ajustes (fonte):',
      listText || '- (nenhum)',
      '',
      'Gere apenas o Markdown final (sem explicações adicionais).',
    ]
      .filter(Boolean)
      .join('\n');

    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        top_p: 0.9,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
        max_tokens: 900,
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'openai_error', details: textBody, trace_id: traceId });
    }

    const parsed = JSON.parse(textBody);
    const rawText: string = parsed?.choices?.[0]?.message?.content?.trim?.() || '';
    const markdown = clampReport(rawText);

    return res.status(200).json({
      markdown,
      model: parsed?.model,
      usage: parsed?.usage,
      trace_id: traceId,
    });
  } catch (e: any) {
    console.error('[ai/store-adjustments-report] error', { trace_id: traceId, message: e?.message || String(e) });
    return res.status(500).json({ error: 'ai_store_adjustments_report_failed', message: e?.message || String(e), trace_id: traceId });
  }
}
