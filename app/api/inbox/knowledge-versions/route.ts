import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Past knowledge/tone versions for this workspace (newest first). The full text
// is returned so "restore" can load it back into the editor for review.
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ versions: [] })

  const { data } = await supabase
    .from('knowledge_versions')
    .select('id, knowledge, tone, created_at')
    .eq('workspace_id', me.workspace_id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ versions: data ?? [] })
}
