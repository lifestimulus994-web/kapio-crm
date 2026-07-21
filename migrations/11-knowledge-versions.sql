-- ============================================================================
-- Migration: knowledge versioning (phase 3 — RAG/KB versioning)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- A history of the inbox AI knowledge + tone. On every save we snapshot the
-- PREVIOUS values here, so the owner can review past versions and roll back
-- (e.g. after a bad edit, or to bring back last month's prices).
-- ============================================================================

create table if not exists public.knowledge_versions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  knowledge    text not null default '',
  tone         text not null default '',
  saved_by     uuid references public.members(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_knowledge_versions_ws
  on public.knowledge_versions(workspace_id, created_at desc);
