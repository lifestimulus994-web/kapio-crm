import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Per-workspace inbox AI settings: the auto-reply toggle + the free-text
// knowledge the business fills in for the AI to answer from.
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  const { data } = await supabase
    .from('inbox_settings')
    .select('ai_enabled, knowledge')
    .eq('workspace_id', me.workspace_id)
    .maybeSingle()

  return NextResponse.json({
    ai_enabled: data?.ai_enabled ?? false,
    knowledge: data?.knowledge ?? '',
  })
}

export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { ai_enabled?: boolean; knowledge?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  const { error } = await supabase.from('inbox_settings').upsert(
    {
      workspace_id: me.workspace_id,
      ai_enabled: !!body.ai_enabled,
      knowledge: typeof body.knowledge === 'string' ? body.knowledge : '',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
