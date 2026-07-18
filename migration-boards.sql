-- ============================================================================
-- Migration: strategy boards (brain-map canvas for sales strategies)
-- Run this whole file once in Supabase Dashboard -> SQL Editor.
-- ============================================================================

create table if not exists public.boards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by   uuid references public.members(id) on delete set null,
  name         text not null default 'ახალი დაფა',
  -- Whole canvas as one JSON blob: { nodes: [...], edges: [...] } in
  -- React Flow's own format. Boards are edited by one person at a time, so
  -- last-write-wins on the full document is fine.
  data         jsonb not null default '{"nodes": [], "edges": []}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_boards_workspace on public.boards(workspace_id, updated_at desc);
