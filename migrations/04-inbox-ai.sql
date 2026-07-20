-- ============================================================================
-- Migration: inbox AI auto-reply
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- Per-workspace toggle + a single free-text knowledge field the business fills
-- in. When enabled, an inbound Messenger/Instagram message is answered by the
-- AI automatically (in the customer's language, only from the knowledge). If
-- the AI can't answer, it hands off: the conversation is flagged for a human
-- instead of guessing. When a human replies in a thread, auto-reply pauses for
-- that thread (conversations.ai_enabled -> false).
-- ============================================================================

create table if not exists public.inbox_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ai_enabled   boolean not null default false,
  knowledge    text not null default '',
  updated_at   timestamptz not null default now()
);

-- Per-conversation auto-reply switch (paused when a human takes over) and a
-- flag the AI raises when it couldn't answer and a human is needed.
alter table public.conversations add column if not exists ai_enabled  boolean not null default true;
alter table public.conversations add column if not exists needs_human boolean not null default false;
