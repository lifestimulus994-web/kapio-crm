-- ============================================================================
-- Migration: enable Row Level Security (defense-in-depth)
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- The app reads/writes every table server-side with the SERVICE ROLE key,
-- which BYPASSES RLS — so enabling RLS with no permissive policies does NOT
-- break the app. The browser only ever calls supabase.auth.* (never queries
-- tables), and handle_new_user() is SECURITY DEFINER, so signup still works.
--
-- Effect: if the public ANON key ever leaks, it grants ZERO table access — no
-- customer data, tokens, or conversations can be read with it.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','members','organizations','contacts','opportunities','tasks',
    'organization_comments','contact_comments','opportunity_comments','task_comments',
    'leads','job_postings','job_sync_state','tool_failures','ai_usage','boards',
    'channel_connections','conversations','messages','inbox_settings',
    'notifications','ai_decisions','knowledge_versions'
  ]
  loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      -- ENABLE only (not FORCE): the table owner still bypasses RLS, so the
      -- SECURITY DEFINER signup trigger keeps working; service_role bypasses
      -- via its BYPASSRLS attribute; anon/authenticated get no access.
      execute format('alter table public.%I enable row level security;', t);
    end if;
  end loop;
end $$;
