import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase email confirmation / magic links redirect here with a `code` param.
// Exchange it for a session cookie, then send the user into the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  return NextResponse.redirect(`${origin}/login`)
}
