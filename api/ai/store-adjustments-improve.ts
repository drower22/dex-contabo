import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

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

    const { what_was_done, why_was_done, expected_results } = req.body || {};

    const what = String(what_was_done ?? '').trim();
    const why = String(why_was_done ?? '').trim();
    const expected = String(expected_results ?? '').trim();

    if (!what || !why || !expected) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'what_was_done, why_was_done e expected_results são obrigatórios',
        trace_id: traceId,
      });
    }

    const system = [
      'Você é um revisor de texto (pt-BR) especializado em transformar anotações em texto de RELATÓRIO curto e objetivo.',
      'Tarefa: reescrever 3 campos (what_was_done, why_was_done, expected_results) para ficarem mais profissionais e bem resumidos.',
      'Regras obrigatórias:',
      '- Idioma: pt-BR.',
      '- Não use emojis.',
      '- Não invente dados (números, prazos, metas) que não estejam no texto original.',
      '- Preserve números existentes, mas elimine redundâncias.',
      '- Cada campo deve virar 1 frase curta, estilo relatório, com verbo no passado quando fizer sentido.',
      '- Limite sugerido: até 110 caracteres por campo.',
      '- Se o texto original já estiver curto, AINDA ASSIM reescreva (sinônimos, ordem, formalização) para ficar perceptivelmente diferente.',
      '',
      'Formato desejado (exemplos):',
      '- what_was_done: "Ajustado raio de entrega para 3 km."',
      '- why_was_done: "Reduzir custos e otimizar cobertura de entrega."',
      '- expected_results: "Diminuir despesas e melhorar eficiência operacional."',
      '',
      'Retorne APENAS um JSON válido com as chaves: what_was_done, why_was_done, expected_results.',
    ].join('\n');

    const user = [
      'Reescreva os campos abaixo conforme as regras. Retorne SOMENTE JSON.',
      JSON.stringify({ what_was_done: what, why_was_done: why, expected_results: expected }),
    ].join('\n');

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
        response_format: { type: 'json_object' },
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 250,
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'openai_error', details: textBody, trace_id: traceId });
    }

    const parsed = JSON.parse(textBody);
    const rawText: string = parsed?.choices?.[0]?.message?.content?.trim?.() || '';

    let improved: any = null;
    try {
      improved = JSON.parse(rawText);
    } catch {
      // fallback: return original texts
      improved = null;
    }

    const normalize = (s: string) => String(s || '').trim().replace(/\s+/g, ' ');
    const sameish = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase();

    let outWhat = normalize(String(improved?.what_was_done ?? what));
    let outWhy = normalize(String(improved?.why_was_done ?? why));
    let outExpected = normalize(String(improved?.expected_results ?? expected));

    // Fallback: se vier praticamente igual, forçar uma versão mais "relatório" sem inventar dados
    if (sameish(outWhat, what)) outWhat = normalize(`Ajuste realizado: ${what}`);
    if (sameish(outWhy, why)) outWhy = normalize(`Motivo: ${why}`);
    if (sameish(outExpected, expected)) outExpected = normalize(`Objetivo: ${expected}`);

    const out = {
      what_was_done: outWhat,
      why_was_done: outWhy,
      expected_results: outExpected,
      trace_id: traceId,
    };

    return res.status(200).json(out);
  } catch (e: any) {
    console.error('[ai/store-adjustments-improve] error', { trace_id: traceId, message: e?.message || String(e) });
    return res.status(500).json({ error: 'ai_store_adjustments_improve_failed', message: e?.message || String(e), trace_id: traceId });
  }
}
