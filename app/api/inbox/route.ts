import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Inbox is workspace-shared: every member sees the same conversation list
// (like strategy boards), so scoping is by workspace_id only.
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  const { data, error } = await supabase
    .from('conversations')
    .select('id, name, platform, source, ad_id, last_message_at, last_message_preview, unread, lead_id, needs_human, ai_enabled')
    .eq('workspace_id', me.workspace_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ conversations: data ?? [] })
}
