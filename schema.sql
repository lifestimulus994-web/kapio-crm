-- ============================================================================
-- Kapio CRM — database schema
--
-- Run this in Supabase Dashboard → SQL Editor. Safe to paste the WHOLE file
-- top to bottom, every time, on a fresh database or an existing one — every
-- statement is idempotent (if not exists / or replace / drop-then-add).
--
-- Sections, each self-contained and safe to re-run on its own:
--   1. Workspaces & team        — tenants, member accounts, roles
--   2. Core CRM tables          — organizations, contacts, opportunities, tasks
--   3. Comments / activity feed — one comment table per core entity
--   4. Leads                    — funnel-entry, separate from organizations
--   5. Job board signals        — jobs.ge / hr.ge vacancy cache, AI-queryable
--   6. Diagnostics              — AI tool-failure log + per-workspace AI usage/cost
--   7. Grants                   — Supabase API role access
--   8. Auth trigger             — auto-provisions a workspace at signup
--   9. ONE-TIME MANUAL BACKFILL — commented out; multi-tenant AND approval-gate
--                                  backfills (run each once, see comments)
-- ============================================================================


-- ============================================================================
-- 1. WORKSPACES & TEAM
-- Every signup gets its own isolated workspace (tenant). All app code filters
-- by workspace_id — the service-role client bypasses RLS, so isolation is
-- enforced in application code, same as every other access rule in this app.
-- Roles: 'owner' (workspace creator) / 'manager' (sees & manages everything
-- an owner can, minus workspace-level actions) / 'member' (only records
-- assigned to them — enforced in app code via assigned_to on each table).
-- ============================================================================

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
-- Plan chosen at signup (Starter/Business/Pro). No billing/payment wired up
-- yet — this only records intent, shown on the Team page.
alter table public.workspaces add column if not exists plan text not null default 'starter';
alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.workspaces add constraint workspaces_plan_check
  check (plan in ('starter', 'business', 'pro'));

-- Approval gate: a brand-new self-signup workspace starts 'pending' and
-- every member of it is blocked (redirected to /pending-approval by
-- requireMember() in lib/auth.ts) until the platform super-admin approves
-- it in /admin. See the ONE-TIME BACKFILL near the bottom of this file —
-- it must be run once, right after this ALTER, so every workspace that
-- already existed before this feature shipped is grandfathered in as
-- 'approved' instead of getting retroactively locked out.
alter table public.workspaces add column if not exists status text not null default 'pending';
alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- Team accounts. id mirrors auth.users.id 1:1 — created either by the public
-- /signup form (self-signup, becomes 'owner' of a brand-new workspace) or by
-- an owner inviting a teammate via app/api/team (admin.auth.admin.createUser,
-- joins the inviter's EXISTING workspace as 'manager' or 'member'). See the
-- handle_new_user() trigger in section 7 — it is the only writer of this
-- table; nothing inserts into it directly from application code.
create table if not exists public.members (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'member',
  workspace_id uuid references public.workspaces(id),
  created_at timestamptz not null default now()
);
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'manager', 'member'));

-- Approval gate at the PERSON level, on top of the workspace-level one above:
-- every new member — a self-signup owner AND every teammate an owner/manager
-- invites afterward — starts 'pending' and is blocked until the super-admin
-- approves them individually in /admin, which also records who invited them.
alter table public.members add column if not exists status text not null default 'pending';
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('pending', 'approved', 'rejected'));
alter table public.members add column if not exists invited_by uuid references public.members(id);
-- Nullable on purpose: existing pre-multi-tenant rows have none yet. Backfill
-- (section 8) before ever relying on this being non-null.
alter table public.members add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_members_workspace on public.members(workspace_id);

alter table public.members enable row level security;
-- Any logged-in teammate can see the team list. All writes go through the
-- service-role client in app/api/team (owner-only check happens there), so
-- no insert/update/delete policy is needed for the authenticated role.
drop policy if exists "members can view team" on public.members;
create policy "members can view team" on public.members
  for select to authenticated using (true);


-- ============================================================================
-- 2. CORE CRM TABLES
-- organizations → contacts → opportunities → tasks, in dependency order.
-- Every table carries: workspace_id (tenant isolation, section 1) and
-- assigned_to (per-record visibility for a plain 'member', references
-- members.id — owner/manager see everything in the workspace regardless).
-- ============================================================================

-- --- Organizations --------------------------------------------------------
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
-- Soft delete: the AI agent (and the UI) archive instead of hard-deleting, so
-- a misheard name never causes an unrecoverable loss. Archived rows are
-- excluded from buildContext() and the default list views but stay in the DB.
alter table public.organizations add column if not exists archived     boolean not null default false;
alter table public.organizations add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.organizations add column if not exists assigned_to  uuid references public.members(id) on delete set null;
create index if not exists idx_organizations_workspace on public.organizations(workspace_id);
create index if not exists idx_organizations_assigned  on public.organizations(assigned_to);

-- --- Contacts ---------------------------------------------------------------
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
alter table public.contacts add column if not exists archived     boolean not null default false;
alter table public.contacts add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.contacts add column if not exists assigned_to  uuid references public.members(id) on delete set null;
create index if not exists idx_contacts_org       on public.contacts(organization_id);
create index if not exists idx_contacts_workspace on public.contacts(workspace_id);
create index if not exists idx_contacts_assigned  on public.contacts(assigned_to);

-- --- Opportunities (pipeline) ------------------------------------------------
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
-- Detail fields (owner name / lead source / time frames). owner here is a
-- free-text display field, unrelated to assigned_to below.
alter table public.opportunities add column if not exists owner       text;
alter table public.opportunities add column if not exists source      text;
alter table public.opportunities add column if not exists start_date  date;
alter table public.opportunities add column if not exists close_date  date;
-- Required reason when a deal is marked Lost — surfaces "why we lose deals"
-- analysis instead of just a stage change.
alter table public.opportunities add column if not exists lost_reason text;
alter table public.opportunities add column if not exists archived     boolean not null default false;
alter table public.opportunities add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.opportunities add column if not exists assigned_to  uuid references public.members(id) on delete set null;
create index if not exists idx_opps_org         on public.opportunities(organization_id);
create index if not exists idx_opps_contact     on public.opportunities(contact_id);
create index if not exists idx_opportunities_workspace on public.opportunities(workspace_id);
create index if not exists idx_opportunities_assigned  on public.opportunities(assigned_to);

-- --- Tasks --------------------------------------------------------------------
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
  owner           text,                             -- free-text display field
  status          text not null default 'todo',
  created_at      timestamptz not null default now()
);
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists priority   text not null default 'Medium';
alter table public.tasks add column if not exists owner      text;
-- Calendar scheduling (timed events with a duration). start_at/end_at are
-- precise timestamps; all_day marks a whole-day event. Legacy start_date/
-- due_date stay for backward compatibility.
alter table public.tasks add column if not exists start_at timestamptz;
alter table public.tasks add column if not exists end_at   timestamptz;
alter table public.tasks add column if not exists all_day  boolean not null default true;
alter table public.tasks add column if not exists archived     boolean not null default false;
alter table public.tasks add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.tasks add column if not exists assigned_to  uuid references public.members(id) on delete set null;
create index if not exists idx_tasks_opp         on public.tasks(opportunity_id);
create index if not exists idx_tasks_contact     on public.tasks(contact_id);
create index if not exists idx_tasks_org         on public.tasks(organization_id);
create index if not exists idx_tasks_workspace   on public.tasks(workspace_id);
create index if not exists idx_tasks_assigned    on public.tasks(assigned_to);


-- ============================================================================
-- 3. COMMENTS / ACTIVITY FEED
-- One comment table per core entity, same shape each time: who wrote it, the
-- text, when. workspace_id is scoping only (comments don't get their own
-- assigned_to — visibility follows the parent record's).
-- ============================================================================

create table if not exists public.organization_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author          text not null default 'You',
  body            text not null,
  created_at      timestamptz not null default now()
);
alter table public.organization_comments add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_org_comments_org on public.organization_comments(organization_id);

create table if not exists public.contact_comments (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author     text not null default 'You',
  body       text not null,
  created_at timestamptz not null default now()
);
alter table public.contact_comments add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_contact_comments_contact on public.contact_comments(contact_id);

create table if not exists public.opportunity_comments (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  author         text not null default 'You',
  body           text not null,
  created_at     timestamptz not null default now()
);
alter table public.opportunity_comments add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_opp_comments_opp on public.opportunity_comments(opportunity_id);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author     text not null default 'You',
  body       text not null,
  created_at timestamptz not null default now()
);
alter table public.task_comments add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_task_comments_task on public.task_comments(task_id);


-- ============================================================================
-- 4. LEADS
-- A separate, lightweight funnel-entry entity. The owner/manager distributes
-- each lead to a team member (assigned_to); a plain member only ever sees
-- leads assigned to them (enforced in app code). "company" is free text, not
-- a foreign key — a lead often names a company before it exists as a real
-- organizations row.
-- ============================================================================

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
alter table public.leads add column if not exists workspace_id uuid references public.workspaces(id);
create index if not exists idx_leads_assigned  on public.leads(assigned_to);
create index if not exists idx_leads_workspace on public.leads(workspace_id);


-- ============================================================================
-- 5. JOB BOARD SIGNALS
-- Public, workspace-independent cache of EVERY vacancy pulled daily from
-- jobs.ge and hr.ge (app/api/cron/job-boards), any role. A company posting
-- new vacancies is a lead-gen signal — the AI agent's get_job_postings tool
-- queries this so "when did company X post a vacancy" has a real answer.
-- Not scoped by workspace_id: it's public labor-market data, same for every
-- tenant, so it is fetched once and shared rather than duplicated per workspace.
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

-- hr.ge has no bulk search API — syncing walks its sitemap's announcement ids
-- newest-first and stops once it reaches an id already CHECKED. This tracks
-- that watermark separately from job_postings so a sync failure partway
-- through (a single bad announcement fetch) doesn't cause the same ids to
-- be re-fetched on every subsequent run.
create table if not exists public.job_sync_state (
  source  text primary key,
  last_id bigint not null default 0
);


-- ============================================================================
-- 6. DIAGNOSTICS
-- Logs unexpected AI tool-call failures (not ordinary "not found" results,
-- which the tool already returns as a normal {success:false} value) so they
-- can be reviewed later without relying on short-lived platform logs. Also
-- meters real Gemini token usage per workspace so plan spend limits
-- (lib/ai-usage.ts) can be enforced.
-- ============================================================================

create table if not exists public.tool_failures (
  id         uuid primary key default gen_random_uuid(),
  tool_name  text not null,
  args       jsonb,
  error      text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tool_failures_created on public.tool_failures(created_at desc);

-- One row per Gemini API call. cost_usd is computed at insert time from the
-- call's real token counts (lib/ai-cost.ts) against published per-token
-- pricing — an estimate, not a reconciliation against Google's actual bill,
-- but accurate enough to gate a plan's monthly spend limit.
create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id),
  route         text not null, -- 'chat' | 'voice' | 'transcribe' | 'task_complete' | 'company_lookup'
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  audio_input   boolean not null default false,
  grounded      boolean not null default false,
  cost_usd      numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ai_usage_workspace_created on public.ai_usage(workspace_id, created_at);


-- ============================================================================
-- 7. GRANTS
-- Supabase sets sane defaults, but be explicit about API role access.
-- ============================================================================

grant all on all tables in schema public to anon, authenticated, service_role;


-- ============================================================================
-- 8. AUTH TRIGGER
-- Auto-provisions a member row for every NEW auth.users row — both paths:
--   - Self-signup (supabase.auth.signUp, the public /signup form): gets a
--     BRAND NEW workspace, role 'owner'. Identified by the ABSENCE of
--     invited_workspace_id in the user's metadata.
--   - Owner-invited teammate (app/api/team/route.ts, admin.auth.admin.createUser):
--     that route passes user_metadata.invited_workspace_id = the inviting
--     owner's workspace_id (plus invited_role = 'manager'|'member', default
--     'member' — an invite can never grant 'owner' — and invited_by = the
--     inviter's own member id, for the audit trail in /admin), so this
--     trigger joins them to THAT workspace instead of minting a new one. The
--     route itself does NOT insert into members separately — this trigger is
--     the only writer, so there's no duplicate-key race between the two.
--   Every new member row — either path — starts status='pending': a fresh
--   signup needs the workspace itself approved (blocks everyone in it); an
--   invited teammate needs their OWN row approved even though the workspace
--   is already live. See lib/auth.ts requireMember() for the gate.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_workspace_id uuid;
  invited_id uuid;
  invited_role text;
  inviter_id uuid;
  chosen_plan text;
begin
  invited_id := (new.raw_user_meta_data->>'invited_workspace_id')::uuid;

  if invited_id is not null then
    invited_role := case
      when new.raw_user_meta_data->>'invited_role' = 'manager' then 'manager'
      else 'member'
    end;
    inviter_id := (new.raw_user_meta_data->>'invited_by')::uuid;
    insert into public.members (id, workspace_id, email, full_name, role, status, invited_by)
    values (new.id, invited_id, new.email, new.raw_user_meta_data->>'full_name', invited_role, 'pending', inviter_id)
    on conflict (id) do nothing;
    return new;
  end if;

  chosen_plan := case
    when new.raw_user_meta_data->>'plan' in ('starter', 'business', 'pro')
      then new.raw_user_meta_data->>'plan'
    else 'starter'
  end;

  insert into public.workspaces (name, plan)
  values (coalesce(new.raw_user_meta_data->>'business_name', 'My Business'), chosen_plan)
  returning id into new_workspace_id;

  insert into public.members (id, workspace_id, email, full_name, role, status)
  values (new.id, new_workspace_id, new.email, new.raw_user_meta_data->>'full_name', 'owner', 'pending')
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 9. ONE-TIME MANUAL BACKFILL — commented out, run by hand, once
-- Only needed if this database had data BEFORE multi-tenancy was added
-- (i.e. rows with a null workspace_id). Creates one "Kapio" workspace and
-- backfills every existing row + your own member row into it. Safe to
-- re-run (idempotent via the "still null" guards). Run this AFTER section 1
-- has been applied, BEFORE relying on workspace_id anywhere.
-- ============================================================================

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

-- ---------------------------------------------------------------------------
-- ONE-TIME MANUAL STEP for the approval gate: run this ONCE, right after
-- adding workspaces.status/members.status above, and NEVER again (unlike the
-- rest of this file, this is NOT safe to re-run — running it a second time
-- would auto-approve every real pending signup/invite that had shown up
-- since). Marks every workspace AND member that already existed before the
-- approval gate shipped as 'approved', so nobody currently using the app
-- gets locked out.
-- ---------------------------------------------------------------------------
-- update public.workspaces set status = 'approved' where status = 'pending';
-- update public.members    set status = 'approved' where status = 'pending';
