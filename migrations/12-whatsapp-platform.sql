-- ============================================================================
-- Migration: allow WhatsApp channel (phase 3 — WhatsApp)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- channel_connections.platform was checked against ('facebook','instagram').
-- WhatsApp connections use platform 'whatsapp' (page_id = the business
-- phone_number_id), so widen the constraint.
-- ============================================================================

alter table public.channel_connections drop constraint if exists channel_connections_platform_check;
alter table public.channel_connections
  add constraint channel_connections_platform_check
  check (platform in ('facebook', 'instagram', 'whatsapp'));
