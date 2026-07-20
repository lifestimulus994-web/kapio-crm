import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCurrentMember } from '@/lib/auth'
import { oauthDialogUrl } from '@/lib/meta'

export const dynamic = 'force-dynamic'

// Kick off the Facebook + Instagram connect flow: send the logged-in user to
// Meta's OAuth dialog. A random `state` is stored in a short-lived cookie and
// checked on the way back to block CSRF.
export async function GET(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.redirect(new URL('/login', req.url))

  const origin = new URL(req.url).origin
  const redirectUri = `${origin}/api/channels/facebook/callback`
  const state = randomBytes(16).toString('hex')

  const res = NextResponse.redirect(oauthDialogUrl(redirectUri, state))
  res.cookies.set('fb_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
