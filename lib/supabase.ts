import { createClient } from '@supabase/supabase-js'

// Server-only client. All data access in this app runs in Server Components
// and Server Actions, so we use the service role key (bypasses RLS).
// SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so it is never
// exposed to the browser. Do NOT import this from a 'use client' component.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
