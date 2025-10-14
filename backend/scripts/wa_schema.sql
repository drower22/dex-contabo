-- WhatsApp data model for Dex
-- Run these in Supabase SQL editor (adjust types/constraints to your needs)

create table if not exists public.wa_contacts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_number text unique not null,
  profile_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  contact_id uuid not null references public.wa_contacts(id) on delete cascade,
  status text not null default 'open', -- open | closed
  last_message_at timestamptz default now(),
  created_at timestamptz not null default now()
);

create index if not exists wa_conversations_contact_idx on public.wa_conversations(contact_id);
create index if not exists wa_conversations_status_idx on public.wa_conversations(status);
create index if not exists wa_conversations_last_msg_idx on public.wa_conversations(last_message_at desc);

create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  direction text not null, -- in | out
  type text not null, -- text | media | template | ...
  json_payload jsonb not null,
  wa_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_conversation_idx on public.wa_messages(conversation_id);
create index if not exists wa_messages_created_idx on public.wa_messages(created_at desc);

create table if not exists public.wa_state (
  conversation_id uuid primary key references public.wa_conversations(id) on delete cascade,
  step text not null,
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Trigger to keep wa_state.updated_at fresh (optional)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger trg_wa_state_updated
before update on public.wa_state
for each row execute function public.set_updated_at();
