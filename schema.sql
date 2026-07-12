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

-- Comments on organizations and contacts (mirrors task_comments / opportunity_comments).
create table if not exists public.organization_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author          text not null default 'You',
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_org_comments_org on public.organization_comments(organization_id);

create table if not exists public.contact_comments (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author     text not null default 'You',
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_comments_contact on public.contact_comments(contact_id);

-- Leads: a separate, lightweight funnel-entry entity. The owner distributes
-- each lead to a team member by name (assigned_to); a member only ever sees
-- leads assigned to them (enforced in app code, same pattern as team routes).
-- "company" is free text, not a foreign key — a lead often names a company
-- before it exists as a real organizations row.
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  email       text,
  company     text,
  source      text,
  notes       text,
  status      text not null default 'new' check (status in ('new','contacted','converted','lost')),
  assigned_to uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_leads_assigned on public.leads(assigned_to);

-- ============================================================================
-- Multi-tenancy: every signup gets its own isolated workspace. All app code
-- filters by workspace_id (the service-role client bypasses RLS, so isolation
-- is enforced in application code, same as every other access rule so far).
-- ============================================================================

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Added nullable first since existing rows have none yet. After running this
-- file: backfill your existing data into one workspace, THEN run the
-- `set not null` block further down.
alter table public.members               add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.organizations         add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.contacts              add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.opportunities         add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.tasks                 add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.leads                 add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.organization_comments add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.contact_comments      add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.opportunity_comments  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_comments         add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_members_workspace       on public.members(workspace_id);
create index if not exists idx_organizations_workspace on public.organizations(workspace_id);
create index if not exists idx_contacts_workspace       on public.contacts(workspace_id);
create index if not exists idx_opportunities_workspace  on public.opportunities(workspace_id);
create index if not exists idx_tasks_workspace          on public.tasks(workspace_id);
create index if not exists idx_leads_workspace          on public.leads(workspace_id);

-- Auto-provisions a member row for every NEW auth.users row — both paths:
--   - Self-signup (supabase.auth.signUp, the public /signup form): gets a
--     BRAND NEW workspace, role 'owner'. Identified by the ABSENCE of
--     invited_workspace_id in the user's metadata.
--   - Owner-invited teammate (app/api/team/route.ts, admin.auth.admin.createUser):
--     that route passes user_metadata.invited_workspace_id = the inviting
--     owner's workspace_id (plus invited_role = 'manager'|'member', default
--     'member' — an invite can never grant 'owner'), so this trigger joins
--     them to THAT workspace instead of minting a new one. The route itself
--     does NOT insert into members separately — this trigger is the only
--     writer, so there's no duplicate-key race between the two.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_workspace_id uuid;
  invited_id uuid;
  invited_role text;
begin
  invited_id := (new.raw_user_meta_data->>'invited_workspace_id')::uuid;

  if invited_id is not null then
    invited_role := case
      when new.raw_user_meta_data->>'invited_role' = 'manager' then 'manager'
      else 'member'
    end;
    insert into public.members (id, workspace_id, email, full_name, role)
    values (new.id, invited_id, new.email, new.raw_user_meta_data->>'full_name', invited_role)
    on conflict (id) do nothing;
    return new;
  end if;

  insert into public.workspaces (name)
  values (coalesce(new.raw_user_meta_data->>'business_name', 'My Business'))
  returning id into new_workspace_id;

  insert into public.members (id, workspace_id, email, full_name, role)
  values (new.id, new_workspace_id, new.email, new.raw_user_meta_data->>'full_name', 'owner')
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ONE-TIME MANUAL STEP for existing data: run this AFTER the alter table
-- blocks above, BEFORE relying on workspace_id anywhere. Creates a workspace
-- for your existing business and backfills every row + your own member row
-- into it. Safe to re-run (idempotent via the "still null" guards).
-- ---------------------------------------------------------------------------
-- do $$
-- declare
--   kapio_workspace_id uuid;
-- begin
--   select id into kapio_workspace_id from public.workspaces where name = 'Kapio' limit 1;
--   if kapio_workspace_id is null then
--     insert into public.workspaces (name) values ('Kapio') returning id into kapio_workspace_id;
--   end if;
--
--   update public.members               set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.organizations         set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.contacts              set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.opportunities         set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.tasks                 set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.leads                 set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.organization_comments set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.contact_comments      set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.opportunity_comments  set workspace_id = kapio_workspace_id where workspace_id is null;
--   update public.task_comments         set workspace_id = kapio_workspace_id where workspace_id is null;
-- end $$;
--
-- -- Only after the backfill above has actually run:
-- alter table public.members               alter column workspace_id set not null;
-- alter table public.organizations         alter column workspace_id set not null;
-- alter table public.contacts              alter column workspace_id set not null;
-- alter table public.opportunities         alter column workspace_id set not null;
-- alter table public.tasks                 alter column workspace_id set not null;
-- alter table public.leads                 alter column workspace_id set not null;
-- alter table public.organization_comments alter column workspace_id set not null;
-- alter table public.contact_comments      alter column workspace_id set not null;
-- alter table public.opportunity_comments  alter column workspace_id set not null;
-- alter table public.task_comments         alter column workspace_id set not null;

-- ============================================================================
-- Roles + per-record ownership/visibility: a third 'manager' role (sees/edits
-- everything an owner can within their workspace, minus workspace-level
-- actions like billing or removing an owner/manager) plus an assigned_to FK
-- on the core entities, mirroring the leads.assigned_to pattern already in
-- use — a plain 'member' only sees records assigned to them (enforced in app
-- code); owner/manager see everything in the workspace.
-- ============================================================================
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'manager', 'member'));

alter table public.organizations add column if not exists assigned_to uuid references public.members(id) on delete set null;
alter table public.contacts      add column if not exists assigned_to uuid references public.members(id) on delete set null;
alter table public.opportunities add column if not exists assigned_to uuid references public.members(id) on delete set null;
alter table public.tasks         add column if not exists assigned_to uuid references public.members(id) on delete set null;

create index if not exists idx_organizations_assigned on public.organizations(assigned_to);
create index if not exists idx_contacts_assigned       on public.contacts(assigned_to);
create index if not exists idx_opportunities_assigned  on public.opportunities(assigned_to);
create index if not exists idx_tasks_assigned          on public.tasks(assigned_to);

-- Required reason when a deal is marked Lost — surfaces "why we lose deals"
-- analysis instead of just a stage change.
alter table public.opportunities add column if not exists lost_reason text;
