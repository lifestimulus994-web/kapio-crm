-- ============================================================================
-- Migration: inbox AI phase 2 — consultation booking
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- Per-workspace booking config lives on inbox_settings. The booking itself is
-- created as a normal task (start_at/end_at) so it shows in the existing
-- /tasks/calendar. Per-conversation booking state drives the collect -> propose
-- -> confirm -> book flow; the backend (not the LLM) computes free slots and
-- creates the appointment.
-- ============================================================================

-- Workspace booking configuration.
alter table public.inbox_settings add column if not exists booking_enabled   boolean not null default false;
alter table public.inbox_settings add column if not exists consult_minutes   int not null default 30;
alter table public.inbox_settings add column if not exists work_days         text not null default '1,2,3,4,5'; -- Mon..Sun = 1..7
alter table public.inbox_settings add column if not exists work_start        text not null default '10:00';
alter table public.inbox_settings add column if not exists work_end          text not null default '19:00';
alter table public.inbox_settings add column if not exists buffer_minutes    int not null default 0;
alter table public.inbox_settings add column if not exists min_notice_hours  int not null default 2;

-- Per-conversation booking state machine.
alter table public.conversations add column if not exists booking_stage  text not null default 'none'; -- none | collecting | proposed | awaiting_confirm | booked
alter table public.conversations add column if not exists booking_name   text;
alter table public.conversations add column if not exists booking_phone  text;
alter table public.conversations add column if not exists proposed_slots jsonb; -- array of ISO start times last offered
alter table public.conversations add column if not exists chosen_slot    timestamptz;
alter table public.conversations add column if not exists booking_task_id uuid references public.tasks(id) on delete set null;
