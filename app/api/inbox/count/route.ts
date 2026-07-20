import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Count of conversations that need attention (unread OR flagged for a human).
// Drives the badge on the sidebar "შემოსული" item.
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ count: 0 })

  const { count } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', me.workspace_id)
    .or('unread.eq.true,needs_human.eq.true')

  return NextResponse.json({ count: count ?? 0 })
}
