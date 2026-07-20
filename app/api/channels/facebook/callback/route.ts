import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'
import {
  exchangeCodeForUserToken,
  listManagedPages,
  subscribePageToApp,
} from '@/lib/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// OAuth redirect target. Meta sends the user back here with `code` + `state`.
// We exchange the code, pull the user's Pages (+ linked Instagram accounts),
// store each as a channel_connection for THIS member's workspace, and
// subscribe every Page to the app webhook. Then back to /inbox.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const inbox = new URL('/inbox', url.origin)

  const me = await getCurrentMember()
  if (!me) return NextResponse.redirect(new URL('/login', url.origin))

  const error = url.searchParams.get('error')
  if (error) {
    inbox.searchParams.set('connect', 'cancelled')
    return NextResponse.redirect(inbox)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('fb_oauth_state='))
    ?.split('=')[1]

  if (!code || !state || !cookieState || state !== cookieState) {
    inbox.searchParams.set('connect', 'error')
    return NextResponse.redirect(inbox)
  }

  try {
    const redirectUri = `${url.origin}/api/channels/facebook/callback`
    const userToken = await exchangeCodeForUserToken(code, redirectUri)
    const pages = await listManagedPages(userToken)

    let connected = 0
    for (const page of pages) {
      // Store the Facebook Page connection.
      await supabase.from('channel_connections').upsert(
        {
          workspace_id: me.workspace_id,
          connected_by: me.id,
          platform: 'facebook',
          page_id: page.id,
          page_name: page.name,
          access_token: page.access_token,
          status: 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'platform,page_id' }
      )

      // A linked Instagram account shares the Page token but is its own
      // connection row so IG threads route to the right workspace too.
      if (page.instagram?.id) {
        await supabase.from('channel_connections').upsert(
          {
            workspace_id: me.workspace_id,
            connected_by: me.id,
            platform: 'instagram',
            page_id: page.instagram.id,
            page_name: page.instagram.username || page.name,
            access_token: page.access_token,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'platform,page_id' }
        )
      }

      try {
        await subscribePageToApp(page.id, page.access_token)
      } catch (e) {
        console.error('[fb connect] subscribe failed', page.id, e)
      }
      connected++
    }

    inbox.searchParams.set('connect', connected > 0 ? 'ok' : 'nopages')
  } catch (e) {
    console.error('[fb connect] failed', e)
    inbox.searchParams.set('connect', 'error')
  }

  const res = NextResponse.redirect(inbox)
  res.cookies.set('fb_oauth_state', '', { path: '/', maxAge: 0 })
  return res
}
