-- ============================================================================
-- Migration: omnichannel inbox (Facebook/Instagram Messenger + Lead Ads)
-- Run this whole file once in Supabase Dashboard -> SQL Editor.
--
-- Model: ONE Meta app receives webhooks for EVERY connected Page across all
-- workspaces. We route an inbound event to the right tenant by looking up the
-- Page id (entry[].id) in channel_connections -> workspace_id. Each Page also
-- carries its own Page access token, used to fetch lead-form data and to send
-- replies back through the Graph API.
-- ============================================================================

-- One row per Facebook/Instagram Page a workspace has connected.
create table if not exists public.channel_connections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  connected_by  uuid references public.members(id) on delete set null,
  platform      text not null default 'facebook' check (platform in ('facebook','instagram')),
  page_id       text not null,          -- Facebook Page id / IG business account id
  page_name     text,
  access_token  text not null,          -- long-lived Page access token
  status        text not null default 'active' check (status in ('active','revoked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A given Page connects to exactly one workspace at a time.
  unique (platform, page_id)
);
create index if not exists idx_channel_conn_workspace on public.channel_connections(workspace_id);
create index if not exists idx_channel_conn_page on public.channel_connections(page_id);

-- One thread per external participant (Messenger PSID / IG-scoped id) per Page.
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  connection_id        uuid references public.channel_connections(id) on delete set null,
  platform             text not null default 'facebook',
  external_id          text not null,          -- sender PSID / IG-scoped id
  name                 text,
  source               text,                   -- 'fb_ad' | 'fb_organic' | 'ig' | 'lead_ad'
  ad_id                text,                    -- set when the thread began from an ad
  ref                  text,                    -- click-to-Messenger ref payload, if any
  lead_id              uuid references public.leads(id) on delete set null,
  last_message_at      timestamptz,
  last_message_preview text,
  unread               boolean not null default true,
  created_at           timestamptz not null default now(),
  -- De-dup: one thread per participant per connected Page.
  unique (connection_id, external_id)
);
create index if not exists idx_conversations_workspace on public.conversations(workspace_id, last_message_at desc);

-- Individual messages inside a conversation.
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  direction        text not null check (direction in ('in','out')),
  body             text,
  external_id      text,                        -- Meta message id (mid) — inbound de-dup
  created_at       timestamptz not null default now(),
  -- Meta can retry a webhook; unique mid keeps a message from landing twice.
  -- (Outbound rows have a null external_id; Postgres allows many nulls.)
  unique (external_id)
);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);
