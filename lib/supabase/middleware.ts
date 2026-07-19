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
  // forms. Everything else requires a session — EXCEPT /api/cron/* and
  // /api/webhooks/*, which external services (Vercel's scheduler, Meta's
  // webhook delivery) call with no browser session at all. They authorize
  // themselves inside the route handler instead (cron: CRON_SECRET Bearer;
  // Meta webhook: X-Hub-Signature-256 + a verify token). Without this
  // exemption every such request gets redirected to /login — a 307 that Meta
  // reads as "callback URL couldn't be validated".
  const publicPaths = new Set(['/', '/login', '/signup'])
  const isPublicPath =
    publicPaths.has(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith('/api/cron/') ||
    request.nextUrl.pathname.startsWith('/api/webhooks/')
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
