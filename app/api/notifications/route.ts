import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET  -> recent notifications for the current member + unread count
// POST -> mark read ({ id } for one, or {} / { all: true } for all)
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ notifications: [], unread: 0 })

  const { data } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read, created_at')
    .eq('member_id', me.id)
    .order('created_at', { ascending: false })
    .limit(30)

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', me.id)
    .eq('read', false)

  return NextResponse.json({ notifications: data ?? [], unread: count ?? 0 })
}

export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { id?: string; all?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body -> mark all */
  }

  const q = supabase.from('notifications').update({ read: true }).eq('member_id', me.id)
  if (body.id) await q.eq('id', body.id)
  else await q.eq('read', false)

  return NextResponse.json({ ok: true })
}
