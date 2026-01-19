import type { Connect } from 'vite';

function readJsonBody<T = any>(req: Connect.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function clampReply(text: string): string {
  const t = (text || '').trim();
  if (t.length < 10) return t.padEnd(10, '.');
  return t;
}

export const aiReviewsReplyHandler: Connect.NextHandleFunction = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
    return;
  }
  try {
    const { review, settings } = await readJsonBody(req);
    const score = review?.score ?? undefined;
    const comment = review?.comment ?? '';
    const orderShortId = review?.orderShortId ?? undefined;
    const createdAt = review?.createdAt ?? undefined;

    const preset: string = settings?.preset || 'empathetic';
    const extra: string = settings?.extraInstructions || '';

    const system = [
      'Você é um assistente que escreve respostas profissionais, claras e úteis a avaliações de clientes no iFood.',
      'Regras:',
      '- O texto final deve ter pelo menos 10 caracteres (não há limite máximo rígido).',
      '- Evite dados sensíveis, gírias, linguagem ofensiva ou acusações.',
      '- Use um tom adequado ao preset informado.',
      '- Sempre reforce que a situação será tratada e que estamos à disposição para dúvidas.',
      '- Se a avaliação for negativa, peça desculpas e demonstre empatia.',
      '- Se for positiva, agradeça de forma sincera e convide a retornar.',
      'Padrões por tipo de reclamação (deduza pelo comentário):',
      '- Qualidade do alimento/produto: NÃO cite o item específico; reforce cuidado e padrão de preparo, peça desculpas, diga que será revisado internamente.',
      '- Atraso na entrega: peça desculpas; explique de forma geral (ex.: alta demanda/variáveis logísticas) sem justificar demais; reforce ações para reduzir atrasos.',
      '- Falta de educação/atendimento: peça desculpas; diga que o atendimento será revisto e reforçado com a equipe.',
      extra ? `- Instruções adicionais: ${extra}` : '',
    ].filter(Boolean).join('\n');

    const user = [
      `Preset: ${preset}`,
      score !== undefined ? `Nota: ${score}` : undefined,
      comment ? `Comentário do cliente: "${comment}"` : 'Sem comentário do cliente.',
      orderShortId ? `Pedido: #${orderShortId}` : undefined,
      createdAt ? `Data: ${createdAt}` : undefined,
      'Escreva apenas a resposta final ao cliente (sem preâmbulo).',
    ].filter(Boolean).join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: 512,
      }),
    });

    const textBody = await resp.text();
    res.statusCode = resp.status;
    res.setHeader('Content-Type', 'application/json');
    if (!resp.ok) {
      res.end(JSON.stringify({ error: 'OpenAI error', details: textBody }));
      return;
    }
    const data = JSON.parse(textBody);
    const text: string = data?.choices?.[0]?.message?.content?.trim?.() || '';
    const finalText = clampReply(text);
    res.end(JSON.stringify({ text: finalText, model: data?.model, usage: data?.usage }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Unexpected error' }));
  }
};

export const aiReviewsModerationHandler: Connect.NextHandleFunction = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
    return;
  }
  try {
    const { review, settings } = await readJsonBody(req);
    const score = review?.score ?? undefined;
    const comment = review?.comment ?? '';

    const preset: string = settings?.preset || 'formal';
    const extra: string = settings?.extraInstructions || '';

    const system = [
      'Você é um assistente que redige um rascunho de solicitação de moderação para avaliações do iFood.',
      'Objetivo: gerar um texto curto, respeitoso e objetivo, justificando a moderação quando há ofensa, linguagem imprópria ou descumprimento das regras.',
      '- Não inclua dados sensíveis. Evite acusações diretas.',
      '- Formato: texto corrido, pronto para copiar e colar.',
      extra ? `- Instruções adicionais: ${extra}` : '',
    ].filter(Boolean).join('\n');

    const user = [
      `Preset: ${preset}`,
      score !== undefined ? `Nota: ${score}` : undefined,
      comment ? `Comentário do cliente: "${comment}"` : 'Sem comentário do cliente.',
      'Gere um rascunho sucinto e educado de pedido de moderação.',
    ].filter(Boolean).join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.5,
        max_tokens: 300,
      }),
    });

    const textBody = await resp.text();
    res.statusCode = resp.status;
    res.setHeader('Content-Type', 'application/json');
    if (!resp.ok) {
      res.end(JSON.stringify({ error: 'OpenAI error', details: textBody }));
      return;
    }
    const data = JSON.parse(textBody);
    const text: string = data?.choices?.[0]?.message?.content?.trim?.() || '';
    res.end(JSON.stringify({ text, model: data?.model, usage: data?.usage }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e?.message || 'Unexpected error' }));
  }
};
