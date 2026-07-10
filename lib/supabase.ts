import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-only client. All data access in this app runs in Server Components
// and Server Actions, so we use the service role key (bypasses RLS).
// SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so it is never
// exposed to the browser. Do NOT import this from a 'use client' component.
//
// Built lazily (on first use, not on import) — Next's build-time "collect
// page data" step imports every route module without a runtime env, so a
// client constructed eagerly at module scope throws and fails the build
// whenever env vars aren't present at build time (e.g. on Vercel before
// they're configured).
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
  }
  return _client
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
})
