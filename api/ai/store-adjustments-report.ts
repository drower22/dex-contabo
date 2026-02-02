import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  return res.status(410).json({
    error: 'gone',
    message: 'Geração de relatório com IA foi removida. Use o relatório gerado a partir dos ajustes salvos.',
  });
}
