-- ============================================================================
-- Migration: AI decision trace (phase 3 — observability)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- One row per auto-reply: what the AI decided and why, plus tokens + latency.
-- Lets us answer "why did the bot do that / how fast / how much" per message.
-- ============================================================================

create table if not exists public.ai_decisions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  trigger_text    text,   -- the inbound message that triggered this
  reply_preview   text,   -- first chars of the reply we sent
  intent          text,
  interest_level  text,
  outcome         text,   -- handled | handoff | booking | off
  handoff         boolean not null default false,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  latency_ms      int not null default 0,
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_decisions_conv on public.ai_decisions(conversation_id, created_at desc);
create index if not exists idx_ai_decisions_ws   on public.ai_decisions(workspace_id, created_at desc);
