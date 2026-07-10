-- Kapio CRM — database schema
-- Run this in Supabase Dashboard → SQL Editor (whole file, top to bottom)

-- Organizations
create table if not exists public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  legal_name          text not null default '',
  identification_code text not null default '',
  email               text not null default '',
  phone               text not null default '',
  website             text,
  address             text,
  industry            text,
  notes               text,
  created_at          timestamptz not null default now()
);

-- Contacts
create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  first_name      text not null,
  last_name       text not null default '',
  email           text,
  phone           text,
  job_title       text,
  notes           text,
  created_at      timestamptz not null default now()
);

-- Opportunities (pipeline)
create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  title           text not null,
  value_gel       numeric not null default 0,
  stage           text not null default 'New Lead',
  pain_points     text,
  notes           text,
  next_action     text,
  created_at      timestamptz not null default now()
);

-- Tasks
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid references public.opportunities(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  title           text not null,
  description     text,
  start_date      date,
  due_date        date,                            -- end date
  priority        text not null default 'Medium',  -- Low | Medium | High | Urgent
  owner           text,
  status          text not null default 'todo',
  created_at      timestamptz not null default now()
);

-- Migration for existing databases (safe to re-run):
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists priority   text not null default 'Medium';
alter table public.tasks add column if not exists owner      text;

-- Opportunity detail fields (owner / source / time frames). Safe to re-run.
alter table public.opportunities add column if not exists owner      text;
alter table public.opportunities add column if not exists source     text;
alter table public.opportunities add column if not exists start_date date;
alter table public.opportunities add column if not exists close_date date;

-- Calendar scheduling for tasks (timed events with a duration). Safe to re-run.
-- start_at/end_at are precise timestamps; all_day marks a whole-day event.
-- Legacy start_date/due_date stay for backward compatibility.
alter table public.tasks add column if not exists start_at timestamptz;
alter table public.tasks add column if not exists end_at   timestamptz;
alter table public.tasks add column if not exists all_day  boolean not null default true;

-- Opportunity activity feed / comments (mirrors task_comments)
create table if not exists public.opportunity_comments (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  author         text not null default 'You',
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_opp_comments_opp on public.opportunity_comments(opportunity_id);

-- Task comments (activity feed shown on a task)
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author      text not null default 'You',
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_task_comments_task on public.task_comments(task_id);
create index if not exists idx_contacts_org      on public.contacts(organization_id);
create index if not exists idx_opps_org          on public.opportunities(organization_id);
create index if not exists idx_opps_contact      on public.opportunities(contact_id);
create index if not exists idx_tasks_opp         on public.tasks(opportunity_id);
create index if not exists idx_tasks_contact     on public.tasks(contact_id);
create index if not exists idx_tasks_org         on public.tasks(organization_id);

-- Grant access to the API roles (Supabase sets defaults, but be explicit)
grant all on all tables in schema public to anon, authenticated, service_role;

-- Team accounts. id mirrors auth.users.id 1:1 — created via Supabase Admin
-- API (see scripts/seed-owner.mjs and app/api/team), never via public signup.
create table if not exists public.members (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

-- Any logged-in teammate can see the team list. All writes go through the
-- service-role client in app/api/team (owner-only check happens there), so
-- no insert/update/delete policy is needed for the authenticated role.
drop policy if exists "members can view team" on public.members;
create policy "members can view team" on public.members
  for select to authenticated using (true);

-- Soft delete: the AI agent (and the UI) archive instead of hard-deleting, so
-- a misheard name never causes an unrecoverable loss. Archived rows are
-- excluded from buildContext() and the default list views but stay in the DB.
alter table public.organizations add column if not exists archived boolean not null default false;
alter table public.contacts      add column if not exists archived boolean not null default false;
alter table public.opportunities add column if not exists archived boolean not null default false;
alter table public.tasks         add column if not exists archived boolean not null default false;

-- Logs unexpected AI tool-call failures (not ordinary "not found" results,
-- which the tool already returns as a normal {success:false} value) so they
-- can be reviewed later without relying on short-lived platform logs.
create table if not exists public.tool_failures (
  id         uuid primary key default gen_random_uuid(),
  tool_name  text not null,
  args       jsonb,
  error      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_failures_created on public.tool_failures(created_at desc);
