/**
 * @file dex-contabo/api/ifood/reviews/settings.ts
 * @description Handler para configurações de resposta automática (Contabo deployment)
 * 
 * Versão do settings.ts para deployment no Contabo.
 * Gerencia configurações do sistema de respostas automáticas para avaliações.
 * 
 * FUNCIONALIDADE:
 * - GET: Obter configurações de uma loja
 * - POST/PUT: Criar ou atualizar configurações
 * 
 * TABELA: ifood_reviews_settings
 * 
 * @example
 * GET /api/ifood/reviews/settings?storeId=123
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-ifood-token, x-client-info, apikey, content-type'
} as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', cors['Access-Control-Allow-Methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);
  if (req.method === 'OPTIONS') return res.status(200).send('ok');

  const traceId = Date.now().toString(36);
  res.setHeader('X-Trace-Id', traceId);

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL as string;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados', traceId });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const url = new URL(req.url || '/', 'https://local');

    if (req.method === 'GET') {
      const storeId = (url.searchParams.get('storeId') || '').trim();
      if (!storeId) return res.status(400).json({ error: 'Parâmetro obrigatório: storeId', traceId });
      
      const { data, error } = await supabase
        .from('ifood_reviews_settings')
        .select('*')
        .eq('store_id', storeId)
        .maybeSingle();
      
      if (error) return res.status(500).json({ error: error.message, traceId });
      return res.status(200).json({ settings: data || null, traceId });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const { storeId, settings } = req.body || {};
      if (!storeId) return res.status(400).json({ error: 'Campo obrigatório: storeId', traceId });
      
      const payload = {
        store_id: String(storeId),
        preset: settings?.preset ?? 'empathetic',
        extra_instructions: settings?.extraInstructions ?? null,
        auto_reply_enabled: !!settings?.autoReplyEnabled,
        rate_limit_per_hour: Number(settings?.rateLimitPerHour || 0),
        max_stars_threshold: Number(settings?.maxStarsThreshold || 5),
        whatsapp_recipients: settings?.whatsappRecipients ?? null,
        whatsapp_time: settings?.whatsappTime ?? null,
        include_top3_daily: !!settings?.includeTop3Daily,
      };
      
      const { data, error } = await supabase
        .from('ifood_reviews_settings')
        .upsert(payload, { onConflict: 'store_id' })
        .select('*')
        .maybeSingle();
      
      if (error) return res.status(500).json({ error: error.message, traceId });
      return res.status(200).json({ settings: data, traceId });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'Method Not Allowed', traceId });

  } catch (e: any) {
    console.error('[ifood-reviews-settings] error', { traceId, err: e?.message || String(e) });
    res.setHeader('X-Trace-Id', traceId);
    return res.status(500).json({ error: 'Erro interno no servidor proxy.', details: e?.message || String(e), traceId });
  }
}
