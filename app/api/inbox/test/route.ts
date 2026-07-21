import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'
import { generateDecision } from '@/lib/inbox-ai'
import { logAiUsage, tooManyRecent } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Try a sample customer question against the CURRENT knowledge + tone, without
// touching any real conversation. Lets the owner see how the bot would answer
// (and whether it would hand off) so they can spot gaps and fill the knowledge.
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { question?: string; history?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }
  const question = (body.question ?? '').trim()
  if (!question) return NextResponse.json({ error: 'დაწერე კითხვა.' }, { status: 400 })

  if (await tooManyRecent(me.workspace_id, 'inbox_test', 20))
    return NextResponse.json({ error: 'ცოტა ხანში სცადეთ.' }, { status: 429 })

  const { data: settings } = await supabase
    .from('inbox_settings')
    .select('knowledge, tone')
    .eq('workspace_id', me.workspace_id)
    .maybeSingle()

  // Build a tiny transcript: a prior greeting (so it doesn't re-greet) + the
  // test question as the latest customer message.
  const transcript = `Us: გამარჯობა!\nCustomer: ${question}`

  const decision = await generateDecision(
    settings?.knowledge ?? '',
    settings?.tone ?? '',
    transcript,
    true, // alreadyGreeted — we want a direct answer
    0,
    { enabled: false, stage: 'none', knownName: null, knownPhone: null, proposedSlots: [] }
  )

  await logAiUsage({
    workspaceId: me.workspace_id,
    route: 'inbox_test',
    inputTokens: decision.usage.inputTokens,
    outputTokens: decision.usage.outputTokens,
  })

  return NextResponse.json({
    reply: decision.reply,
    handoff: decision.handoff,
    intent: decision.intent,
    interest_level: decision.interest_level,
  })
}
