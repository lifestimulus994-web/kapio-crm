-- ============================================================================
-- Migration: inbox AI tone/persona
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- A separate field from the knowledge: the knowledge is WHAT the assistant
-- knows, the tone is HOW it should speak (personality, warmth, emoji use,
-- whether to name the company, formality).
-- ============================================================================

alter table public.inbox_settings add column if not exists tone text not null default '';
