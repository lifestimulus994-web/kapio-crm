-- ============================================================================
-- Migration: notifications (bell)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- Per-member feed of things that happened WITHOUT the member's own action:
-- a customer messaged, the AI handed a chat off to a human, a lead or task got
-- assigned to them. Inbox events are written from the app (webhook); lead/task
-- assignment fires from DB triggers so EVERY creation path (UI, AI, API) is
-- covered without touching each call site.
-- ============================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,  -- recipient
  type         text not null,       -- 'message' | 'handoff' | 'lead' | 'task'
  title        text not null,
  body         text,
  link         text,                -- where clicking the notification navigates
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_notifications_member
  on public.notifications(member_id, read, created_at desc);

-- --- lead assigned -> notify the assignee -----------------------------------
create or replace function public.notify_lead_assigned()
returns trigger language plpgsql as $$
begin
  if NEW.assigned_to is not null then
    insert into public.notifications(workspace_id, member_id, type, title, body, link)
    values (NEW.workspace_id, NEW.assigned_to, 'lead', 'ახალი ლიდი',
            coalesce(NEW.full_name, ''), '/leads');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_notify_lead on public.leads;
create trigger trg_notify_lead
  after insert on public.leads
  for each row execute function public.notify_lead_assigned();

-- --- task assigned -> notify the assignee -----------------------------------
create or replace function public.notify_task_assigned()
returns trigger language plpgsql as $$
begin
  if NEW.assigned_to is not null then
    insert into public.notifications(workspace_id, member_id, type, title, body, link)
    values (NEW.workspace_id, NEW.assigned_to, 'task', 'ახალი დავალება',
            coalesce(NEW.title, ''), '/tasks');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_notify_task on public.tasks;
create trigger trg_notify_task
  after insert on public.tasks
  for each row execute function public.notify_task_assigned();
