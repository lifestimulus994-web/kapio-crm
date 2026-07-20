-- ============================================================================
-- Migration: inbox AI phase 1 — structured decision + lead scoring
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- Per-conversation sales signal fields: a deterministic lead score (computed
-- by the backend from signals the AI extracts, NOT the AI's own guess), the
-- detected intent, and a counter to cap how many times we offer a consultation
-- in one thread.
-- ============================================================================

alter table public.conversations add column if not exists lead_score          int  not null default 0;
alter table public.conversations add column if not exists intent              text;
alter table public.conversations add column if not exists interest_level      text;   -- weak | medium | high
alter table public.conversations add column if not exists consultation_offers int  not null default 0;
alter table public.conversations add column if not exists opted_out           boolean not null default false;

create index if not exists idx_conversations_score
  on public.conversations(workspace_id, lead_score desc);
