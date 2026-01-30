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

    const safeStoreName = typeof storeName === 'string' ? storeName.trim() : '';
    const safePeriodLabel = typeof periodLabel === 'string' ? periodLabel.trim() : '';

    const listText = adjustments
      .map((a) => {
        const dt = a?.created_at ? new Date(a.created_at).toISOString() : '';
        const what = String(a?.what_was_done ?? '').trim();
        const why = String(a?.why_was_done ?? '').trim();
        const exp = String(a?.expected_results ?? '').trim();
        return [
          `- Data: ${dt}`,
          what ? `  - O que foi feito: ${what}` : null,
          why ? `  - Por que foi feito: ${why}` : null,
          exp ? `  - Resultado esperado: ${exp}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    const system = [
      'Você é um assistente especializado em gerar relatórios profissionais e claros para clientes (pt-BR).',
      'Você receberá uma lista de ajustes realizados em uma loja e deve produzir um relatório em Markdown.',
      'Regras obrigatórias:',
      '- Idioma: pt-BR.',
      '- Não use emojis.',
      '- Não invente dados, números ou resultados. Use apenas o que estiver no material fornecido.',
      '- Seja objetivo, porém amigável e fácil de ler por um cliente.',
      '- Quando houver muitos itens repetidos, agrupe por tema.',
      '- Se não houver ajustes no período, retorne um relatório curto explicando que não houve registros.',
      '',
      'Estrutura do Markdown:',
      '# Relatório de Ajustes',
      '## Período',
      '## Resumo executivo (3 a 6 bullets)',
      '## Ajustes realizados (bullets agrupados por tema)',
      '## Próximos passos sugeridos (somente se deriváveis dos próprios ajustes; caso contrário, mantenha genérico)',
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
