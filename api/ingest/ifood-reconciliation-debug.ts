import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { runId, merchantId } = req.query;

  if (!runId && !merchantId) {
    return res.status(400).json({ error: 'É obrigatório fornecer runId ou merchantId' });
  }

  try {
    let finalRunId = runId as string;

    if (!finalRunId) {
      const { data: runData, error: runError } = await supabase
        .from('ifood_conciliation_runs')
        .select('id')
        .eq('merchant_id', merchantId as string)
        .order('requested_at', { ascending: false })
        .limit(1)
        .single();

      if (runError || !runData) {
        return res.status(404).json({ error: 'Nenhuma execução encontrada para o merchantId fornecido', details: runError?.message });
      }
      finalRunId = runData.id;
    }

    const { data, error } = await supabase
      .from('ifood_conciliation_logs')
      .select('*')
      .eq('run_id', finalRunId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    res.status(200).json({ runId: finalRunId, logs: data });

  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar logs', message: error.message });
  }
}
