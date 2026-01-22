import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function clampReply(text: string): string {
  const t = (text || '').trim();
  const maxLen = 300;
  const cut = t.length > maxLen ? t.slice(0, maxLen).trimEnd() : t;
  if (cut.length < 10) return cut.padEnd(10, '.');
  return cut;
}

async function tryPersistSuggestion(args: {
  supabase: any;
  reviewId: string;
  suggestion: { text: string; model?: string; usage?: any; createdAt: string };
  traceId: string;
}): Promise<string | null> {
  let suggestionId: string | null = null;
  try {
    const { data: current, error: readError } = await (args.supabase as any)
      .from('ifood_reviews')
      .select('raw')
      .eq('review_id', args.reviewId)
      .maybeSingle();

    if (readError) {
      console.warn('[ai/reviews-reply] read raw error', { trace_id: args.traceId, message: readError.message });
    }

    const raw = (current as any)?.raw ?? {};
    const nextRaw = {
      ...raw,
      ai_reply_suggestion: {
        ...(raw?.ai_reply_suggestion ?? {}),
        ...args.suggestion,
      },
    };

    const { error: updateError } = await (args.supabase as any)
      .from('ifood_reviews')
      .update({ raw: nextRaw } as any)
      .eq('review_id', args.reviewId);

    if (updateError) {
      console.warn('[ai/reviews-reply] update raw error', { trace_id: args.traceId, message: updateError.message });
    }
  } catch (e: any) {
    console.warn('[ai/reviews-reply] persist suggestion exception', { trace_id: args.traceId, message: e?.message || String(e) });
  }

  try {
    const { data, error } = await (args.supabase as any)
      .from('ifood_review_ai_suggestions')
      .insert({
      review_id: args.reviewId,
      suggested_text: args.suggestion.text,
      model: args.suggestion.model ?? null,
      usage: args.suggestion.usage ?? null,
      created_at: args.suggestion.createdAt,
      trace_id: args.traceId,
    } as any)
      .select('id')
      .maybeSingle();

    if (error) {
      console.warn('[ai/reviews-reply] insert ifood_review_ai_suggestions error', { trace_id: args.traceId, message: error.message });
    } else {
      const id = (data as any)?.id;
      if (typeof id === 'string' && id.trim()) suggestionId = id.trim();
    }
  } catch (e: any) {
    console.warn('[ai/reviews-reply] insert suggestion exception', { trace_id: args.traceId, message: e?.message || String(e) });
  }

  try {
    await (args.supabase as any).from('ifood_reviews_events').insert({
      event_type: 'ai_suggestion_generated',
      review_id: args.reviewId,
      trace_id: args.traceId,
      metadata: {
        suggestion_id: suggestionId,
        model: args.suggestion.model ?? null,
      },
    } as any);
  } catch {
    // best-effort
  }

  return suggestionId;
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

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured', trace_id: traceId });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey) as any;

    const { accountId, merchantId, reviewId, settings, variationSeed, variationStyle } = req.body || {};

    if (!accountId || !merchantId || !reviewId) {
      return res.status(400).json({
        error: 'missing_required_params',
        message: 'accountId, merchantId e reviewId são obrigatórios',
        trace_id: traceId,
      });
    }

    let row: any = null;
    let readError: any = null;

    console.log('[ai/reviews-reply] db read start', {
      trace_id: traceId,
      account_id: String(accountId),
      merchant_id: String(merchantId),
      review_id: String(reviewId),
    });

    const baseQuery = (selectStr: string) => {
      console.log('[ai/reviews-reply] db select', { trace_id: traceId, select: selectStr });
      return (supabase as any)
      .from('ifood_reviews_view')
      .select(selectStr)
      .eq('review_id', String(reviewId))
      .eq('account_id', String(accountId))
      .eq('merchant_id', String(merchantId))
      .maybeSingle();
    };

    const buildSelect = (nameField: 'costumer_name' | 'customer_name', includeClientName: boolean) =>
      [
        'review_id',
        'account_id',
        'merchant_id',
        'created_at',
        'score',
        'comment',
        'order_short_id',
        'raw',
        nameField,
        includeClientName ? 'client_name' : null,
      ]
        .filter(Boolean)
        .join(', ');

    const isMissingColumnError = (err: any, col: string): boolean => {
      const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
      return msg.includes(col.toLowerCase()) && msg.includes('does not exist');
    };

    // Try combinations so we can work with older schemas.
    const attempts: Array<{ nameField: 'costumer_name' | 'customer_name'; includeClientName: boolean }> = [
      { nameField: 'costumer_name', includeClientName: true },
      { nameField: 'costumer_name', includeClientName: false },
      { nameField: 'customer_name', includeClientName: true },
      { nameField: 'customer_name', includeClientName: false },
    ];

    for (const a of attempts) {
      ({ data: row, error: readError } = await baseQuery(buildSelect(a.nameField, a.includeClientName)));
      if (!readError) break;

      const missingClientName = isMissingColumnError(readError, 'client_name');
      const missingCostumerName = isMissingColumnError(readError, 'costumer_name');
      const missingCustomerName = isMissingColumnError(readError, 'customer_name');

      console.warn('[ai/reviews-reply] db read error', {
        trace_id: traceId,
        message: readError.message,
        attempt: a,
        missingClientName,
        missingCostumerName,
        missingCustomerName,
      });

      // Only keep iterating on missing-column errors. Otherwise, fail fast.
      if (!(missingClientName || missingCostumerName || missingCustomerName)) {
        break;
      }

      console.log('[ai/reviews-reply] db fallback next attempt', {
        trace_id: traceId,
        next: true,
      });
    }

    if (readError) {
      return res.status(500).json({ error: 'db_read_failed', message: readError.message, trace_id: traceId });
    }

    if (!row?.review_id) {
      return res.status(404).json({ error: 'review_not_found', trace_id: traceId });
    }

    const raw: any = (row as any).raw ?? {};
    const replies = Array.isArray(raw?.replies) ? raw.replies : [];
    if (replies.length > 0) {
      return res.status(409).json({ error: 'already_replied', message: 'Avaliação já possui resposta.', trace_id: traceId });
    }

    const preset: string = settings?.preset || 'empathetic';
    const extra: string = settings?.extraInstructions || '';

    const customerName = typeof (row as any).costumer_name === 'string'
      ? (row as any).costumer_name.trim()
      : (typeof (row as any).customer_name === 'string' ? (row as any).customer_name.trim() : '');
    const clientName = typeof (row as any).client_name === 'string' ? (row as any).client_name.trim() : '';
    const previousSuggestion = typeof raw?.ai_reply_suggestion?.text === 'string' ? raw.ai_reply_suggestion.text.trim() : '';

    const seedStr = typeof variationSeed === 'string' || typeof variationSeed === 'number' ? String(variationSeed) : randomUUID();
    const styleStr = typeof variationStyle === 'string' ? variationStyle : '';
    const styleRulesByKey: Record<string, string> = {
      concise: 'Formato: 2 frases curtas. Sem emojis. Feche com uma frase curta de disponibilidade.',
      warm: 'Formato: 3-4 frases. Tom acolhedor e humano. Sem justificar demais.',
      formal: 'Formato: 3-4 frases. Tom formal e objetivo. Sem exclamações.',
      upbeat: 'Formato: 3-4 frases. Tom positivo. Use 1 exclamação no máximo.',
      direct: 'Formato: 2-3 frases. Vá direto ao ponto. Sem floreios.',
    };
    const styleRule = styleRulesByKey[styleStr] || 'Formato: 3-4 frases. Linguagem natural. Sem repetir estruturas anteriores.';

    const score = typeof (row as any).score === 'number' ? (row as any).score : undefined;
    const comment = typeof (row as any).comment === 'string' ? (row as any).comment : '';
    const orderShortId = typeof (row as any).order_short_id === 'string' ? (row as any).order_short_id : undefined;
    const createdAt = typeof (row as any).created_at === 'string' ? (row as any).created_at : undefined;

    const system = [
      'Você é um assistente que escreve respostas profissionais, claras e úteis a avaliações de clientes no iFood.',
      'Regras:',
      '- O texto final deve ter pelo menos 10 caracteres e no máximo 300 caracteres.',
      '- Evite dados sensíveis, gírias, linguagem ofensiva ou acusações.',
      '- Não prometa reembolso/compensação ou ações fora da plataforma.',
      '- Use um tom adequado ao preset informado.',
      '- Sempre reforce que a situação será tratada e que estamos à disposição para dúvidas.',
      '- Se a avaliação for negativa, peça desculpas e demonstre empatia.',
      '- Se for positiva, agradeça de forma sincera e convide a retornar.',
      clientName ? `- Mencione o nome do cliente (Dex) "${clientName}" na resposta de forma natural.` : '',
      previousSuggestion ? '- Gere uma versão bem diferente da sugestão anterior: mude estrutura, abertura, conectivos e vocabulário. Não reutilize frases.' : '',
      styleRule,
      'Padrões por tipo de reclamação (deduza pelo comentário):',
      '- Qualidade do alimento/produto: NÃO cite o item específico; reforce cuidado e padrão de preparo, peça desculpas, diga que será revisado internamente.',
      '- Atraso na entrega: peça desculpas; explique de forma geral (ex.: alta demanda/variáveis logísticas) sem justificar demais; reforce ações para reduzir atrasos.',
      '- Falta de educação/atendimento: peça desculpas; diga que o atendimento será revisto e reforçado com a equipe.',
      extra ? `- Instruções adicionais: ${extra}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const user = [
      `Preset: ${preset}`,
      `VariationSeed: ${seedStr}`,
      styleStr ? `VariationStyle: ${styleStr}` : undefined,
      score !== undefined ? `Nota: ${score}` : undefined,
      comment ? `Comentário do cliente: "${comment}"` : 'Sem comentário do cliente.',
      customerName ? `Nome do consumidor (iFood): ${customerName}` : undefined,
      clientName ? `Nome do cliente (Dex): ${clientName}` : undefined,
      previousSuggestion ? `Sugestão anterior (não repetir): """${previousSuggestion}"""` : undefined,
      orderShortId ? `Pedido: #${orderShortId}` : undefined,
      createdAt ? `Data: ${createdAt}` : undefined,
      'Escreva apenas a resposta final ao cliente (sem preâmbulo).',
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
        temperature: 0.95,
        top_p: 0.9,
        presence_penalty: 0.6,
        frequency_penalty: 0.4,
        max_tokens: 220,
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'openai_error', details: textBody, trace_id: traceId });
    }

    const data = JSON.parse(textBody);
    const rawText: string = data?.choices?.[0]?.message?.content?.trim?.() || '';
    const finalText = clampReply(rawText);

    const suggestion = {
      text: finalText,
      model: data?.model,
      usage: data?.usage,
      createdAt: new Date().toISOString(),
    };

    const suggestionId = await tryPersistSuggestion({ supabase, reviewId: String(reviewId), suggestion, traceId });

    return res.status(200).json({ ...suggestion, suggestion_id: suggestionId, trace_id: traceId });
  } catch (e: any) {
    console.error('[ai/reviews-reply] error', { trace_id: traceId, message: e?.message || String(e) });
    return res.status(500).json({ error: 'ai_reviews_reply_failed', message: e?.message || String(e), trace_id: traceId });
  }
}
