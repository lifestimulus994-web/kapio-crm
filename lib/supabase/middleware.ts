import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // '/' is the public marketing page; /login and /signup are public auth
  // forms. Everything else requires a session — EXCEPT /api/cron/*, which
  // Vercel's scheduler calls with no browser session at all (it authorizes
  // itself via a CRON_SECRET Bearer token checked inside the route handler,
  // not a cookie); without this exemption every cron request gets redirected
  // to /login before the route ever runs.
  const publicPaths = new Set(['/', '/login', '/signup'])
  const isPublicPath =
    publicPaths.has(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith('/api/cron/')
  const isAuthPage =
    request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/signup'

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (isAuthPage || request.nextUrl.pathname === '/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
