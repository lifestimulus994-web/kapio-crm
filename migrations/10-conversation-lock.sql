-- ============================================================================
-- Migration: per-conversation lock (phase 3 — reliability)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- A best-effort mutex so two overlapping webhook invocations can't generate two
-- replies for the same thread at once. Claimed with an atomic conditional
-- update on this column; released when done (or it simply expires).
-- ============================================================================

alter table public.conversations add column if not exists lock_until timestamptz;
