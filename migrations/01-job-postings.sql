-- ============================================================================
-- Migration: jobs.ge / hr.ge vacancy sync (Kapio AI hiring-signal tool)
-- Run this whole file once in Supabase Dashboard -> SQL Editor.
-- (Same tables also live in schema.sql section 5, for the record — this file
-- is just that one piece pulled out on its own so it's easy to copy/run.)
-- ============================================================================

create table if not exists public.job_postings (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,        -- 'jobs.ge' | 'hr.ge'
  external_id  text not null,        -- the source site's own vacancy id (de-dup key)
  company_name text not null,
  title        text not null,
  posted_at    date,
  url          text,
  created_at   timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists idx_job_postings_company on public.job_postings(company_name);
create index if not exists idx_job_postings_posted  on public.job_postings(posted_at desc);

create table if not exists public.job_sync_state (
  source  text primary key,
  last_id bigint not null default 0
);
