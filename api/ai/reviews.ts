export type GenerateReplyInput = {
  review: {
    score?: number;
    comment?: string;
    orderShortId?: string;
    createdAt?: string;
  };
  settings?: {
    preset?: 'empathetic' | 'formal' | 'casual' | string;
    extraInstructions?: string;
    maxStarsThreshold?: number;
  };
};

export type GenerateReplyOutput = {
  text: string;
  model?: string;
  usage?: any;
};

export async function generateReply(input: GenerateReplyInput, signal?: AbortSignal): Promise<GenerateReplyOutput> {
  const resp = await fetch('/api/ai/reviews-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || 'Falha ao gerar resposta com IA');
  }
  return resp.json();
}

export type GenerateModerationInput = {
  review: {
    score?: number;
    comment?: string;
  };
  settings?: {
    preset?: 'empathetic' | 'formal' | 'casual' | string;
    extraInstructions?: string;
  };
};

export type GenerateModerationOutput = {
  text: string;
  model?: string;
  usage?: any;
};

export async function generateModeration(input: GenerateModerationInput, signal?: AbortSignal): Promise<GenerateModerationOutput> {
  const resp = await fetch('/api/ai/reviews-moderation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || 'Falha ao gerar moderação com IA');
  }
  return resp.json();
}
