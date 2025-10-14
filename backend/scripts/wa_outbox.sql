-- wa_outbox: fila de envios de WhatsApp
-- status: queued | sending | sent | failed

create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  to_number text not null,
  user_number_normalized text,
  template_name text not null,
  lang_code text not null default 'pt_BR',
  components jsonb,
  variables jsonb,
  user_name text,
  attempts int not null default 0,
  status text not null default 'queued',
  last_error text,
  response_json jsonb,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índices úteis
create index if not exists idx_wa_outbox_status_sched on public.wa_outbox (status, scheduled_at);
create index if not exists idx_wa_outbox_to_number on public.wa_outbox (to_number);

-- Trigger opcional para updated_at (se desejado)
-- create extension if not exists moddatetime;
-- create trigger set_timestamp before update on public.wa_outbox
--   for each row execute procedure moddatetime (updated_at);
