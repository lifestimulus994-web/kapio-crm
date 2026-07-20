import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// List the workspace's connected channels (for the inbox header).
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  const { data, error } = await supabase
    .from('channel_connections')
    .select('id, platform, page_name, status, created_at')
    .eq('workspace_id', me.workspace_id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channels: data ?? [] })
}

// Disconnect a channel (soft: mark revoked so history stays).
export async function DELETE(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id საჭიროა.' }, { status: 400 })

  const { error } = await supabase
    .from('channel_connections')
    .update({ status: 'revoked' })
    .eq('id', body.id)
    .eq('workspace_id', me.workspace_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
