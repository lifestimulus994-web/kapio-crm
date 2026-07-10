import { createBrowserClient } from '@supabase/ssr'

// Browser-only client, used from client components (login form, sign-out).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
