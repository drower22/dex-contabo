-- ============================================
-- TABELA: store_analytics_reports
-- Armazena relatórios de análise de loja gerados
-- ============================================

CREATE TABLE IF NOT EXISTS public.store_analytics_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  
  -- Período analisado
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Metadados
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Métricas financeiras (JSON)
  financial_metrics JSONB NOT NULL,
  
  -- Métricas operacionais (JSON)
  operational_metrics JSONB NOT NULL,
  
  -- Análises temporais (JSON)
  weekly_comparison JSONB NOT NULL,
  day_of_week_analysis JSONB NOT NULL,
  time_series JSONB NOT NULL,
  
  -- Benchmarking (JSON, pode ser null)
  benchmark JSONB NULL,
  
  -- Insights gerados (JSON)
  insights JSONB NOT NULL,
  
  -- PDF gerado
  pdf_url TEXT NULL,
  pdf_generated_at TIMESTAMP WITH TIME ZONE NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT store_analytics_reports_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- ============================================
-- ÍNDICES
-- ============================================

-- Busca por conta
CREATE INDEX IF NOT EXISTS idx_store_analytics_reports_account_id 
ON public.store_analytics_reports USING btree (account_id) 
TABLESPACE pg_default;

-- Busca por merchant
CREATE INDEX IF NOT EXISTS idx_store_analytics_reports_merchant_id 
ON public.store_analytics_reports USING btree (merchant_id) 
TABLESPACE pg_default;

-- Busca por período
CREATE INDEX IF NOT EXISTS idx_store_analytics_reports_period 
ON public.store_analytics_reports USING btree (period_start, period_end) 
TABLESPACE pg_default;

-- Busca por data de geração
CREATE INDEX IF NOT EXISTS idx_store_analytics_reports_generated_at 
ON public.store_analytics_reports USING btree (generated_at DESC) 
TABLESPACE pg_default;

-- Busca combinada (mais comum)
CREATE INDEX IF NOT EXISTS idx_store_analytics_reports_account_period 
ON public.store_analytics_reports USING btree (account_id, period_start DESC, period_end DESC) 
TABLESPACE pg_default;

-- ============================================
-- TRIGGER: Atualizar updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_store_analytics_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_analytics_reports_updated
BEFORE UPDATE ON public.store_analytics_reports
FOR EACH ROW
EXECUTE FUNCTION update_store_analytics_reports_updated_at();

-- ============================================
-- COMENTÁRIOS
-- ============================================

COMMENT ON TABLE public.store_analytics_reports IS 'Relatórios de análise de performance de lojas iFood';
COMMENT ON COLUMN public.store_analytics_reports.financial_metrics IS 'Métricas financeiras: faturamento, descontos, ticket médio, etc';
COMMENT ON COLUMN public.store_analytics_reports.operational_metrics IS 'Métricas operacionais: pedidos, cancelamentos, tempos, etc';
COMMENT ON COLUMN public.store_analytics_reports.weekly_comparison IS 'Comparativo semana a semana';
COMMENT ON COLUMN public.store_analytics_reports.day_of_week_analysis IS 'Análise por dia da semana';
COMMENT ON COLUMN public.store_analytics_reports.time_series IS 'Série temporal diária';
COMMENT ON COLUMN public.store_analytics_reports.benchmark IS 'Comparação com média do setor';
COMMENT ON COLUMN public.store_analytics_reports.insights IS 'Insights automáticos: pontos fortes, oportunidades, recomendações';
