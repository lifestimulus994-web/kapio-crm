import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'
import { sendMessage } from '@/lib/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET  -> messages for one conversation (and mark it read)
// POST -> { action: 'reply' | 'draft' | 'lead', text? }

type Convo = {
  id: string
  workspace_id: string
  connection_id: string | null
  external_id: string
  name: string | null
  source: string | null
  lead_id: string | null
  ai_enabled: boolean
  needs_human: boolean
  lead_score: number
  interest_level: string | null
  intent: string | null
}

async function loadConvo(id: string, workspaceId: string): Promise<Convo | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, workspace_id, connection_id, external_id, name, source, lead_id, ai_enabled, needs_human, lead_score, interest_level, intent')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (data as Convo) ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const { id } = await params

  const convo = await loadConvo(id, me.workspace_id)
  if (!convo) return NextResponse.json({ error: 'ვერ მოიძებნა' }, { status: 404 })

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, direction, body, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Opening a thread clears its unread flag.
  await supabase.from('conversations').update({ unread: false }).eq('id', id)

  return NextResponse.json({ conversation: convo, messages: messages ?? [] })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const { id } = await params

  let body: { action?: string; text?: string; enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  const convo = await loadConvo(id, me.workspace_id)
  if (!convo) return NextResponse.json({ error: 'ვერ მოიძებნა' }, { status: 404 })

  switch (body.action) {
    case 'reply':
      return reply(convo, body.text ?? '')
    case 'draft':
      return draft(convo)
    case 'lead':
      return toLead(convo, me.id)
    case 'toggle_ai':
      return toggleAi(convo, body.enabled ?? !convo.ai_enabled)
    default:
      return NextResponse.json({ error: 'უცნობი ქმედება.' }, { status: 400 })
  }
}

// Turn per-thread auto-reply on/off. Turning it back on also clears the
// "needs human" flag.
async function toggleAi(convo: Convo, enabled: boolean) {
  await supabase
    .from('conversations')
    .update({ ai_enabled: enabled, needs_human: enabled ? false : convo.needs_human })
    .eq('id', convo.id)
  return NextResponse.json({ ok: true, ai_enabled: enabled })
}

// --- send a reply back through the Page -----------------------------------
async function reply(convo: Convo, text: string) {
  const clean = text.trim()
  if (!clean) return NextResponse.json({ error: 'ცარიელი პასუხი.' }, { status: 400 })
  if (!convo.connection_id)
    return NextResponse.json({ error: 'არხი გათიშულია.' }, { status: 400 })

  const { data: conn } = await supabase
    .from('channel_connections')
    .select('access_token')
    .eq('id', convo.connection_id)
    .maybeSingle()
  if (!conn?.access_token)
    return NextResponse.json({ error: 'Page token ვერ მოიძებნა.' }, { status: 400 })

  try {
    await sendMessage(convo.external_id, clean, conn.access_token)
  } catch (e) {
    return NextResponse.json(
      { error: `ვერ გაიგზავნა: ${e instanceof Error ? e.message : 'უცნობი'}` },
      { status: 502 }
    )
  }

  const now = new Date().toISOString()
  await supabase.from('messages').insert({
    conversation_id: convo.id,
    workspace_id: convo.workspace_id,
    direction: 'out',
    body: clean,
  })
  // A human just replied → pause auto-reply for this thread and clear the
  // "needs human" flag.
  await supabase
    .from('conversations')
    .update({
      last_message_at: now,
      last_message_preview: clean.slice(0, 200),
      unread: false,
      ai_enabled: false,
      needs_human: false,
    })
    .eq('id', convo.id)

  return NextResponse.json({ ok: true })
}

// --- AI-suggested reply (draft only — not sent) ---------------------------
async function draft(convo: Convo) {
  if (!process.env.GEMINI_API_KEY)
    return NextResponse.json({ error: 'AI არ არის კონფიგურირებული.' }, { status: 500 })

  // Most recent 20 messages, chronological (ascending+limit returns the oldest).
  const { data: recent } = await supabase
    .from('messages')
    .select('direction, body, created_at')
    .eq('conversation_id', convo.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const transcript = (recent ?? [])
    .reverse()
    .filter((m) => m.body)
    .map((m) => `${m.direction === 'in' ? 'კლიენტი' : 'ჩვენ'}: ${m.body}`)
    .join('\n')

  const prompt = `შენ ხარ ქართული ბიზნესის გაყიდვების ასისტენტი, რომელიც პასუხობს Messenger-ის შემოსულ შეტყობინებებს. დაწერე თავაზიანი, მოკლე, ბუნებრივი ქართული პასუხი კლიენტის ბოლო შეტყობინებაზე. მხოლოდ პასუხის ტექსტი დააბრუნე, ბრჭყალების ან ახსნის გარეშე.\n\nსაუბარი:\n${transcript || '(ჯერ ცარიელია)'}\n\nპასუხი:`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    })
    const draftText = (res.text ?? '').trim()
    return NextResponse.json({ draft: draftText })
  } catch (e) {
    return NextResponse.json(
      { error: `დრაფტი ვერ შეიქმნა: ${e instanceof Error ? e.message : 'უცნობი'}` },
      { status: 502 }
    )
  }
}

// --- convert a conversation into a CRM lead --------------------------------
async function toLead(convo: Convo, memberId: string) {
  if (convo.lead_id)
    return NextResponse.json({ ok: true, lead_id: convo.lead_id, already: true })

  const sourceLabel =
    convo.source === 'fb_ad' ? 'Messenger (Ad)'
      : convo.source === 'ig' ? 'Instagram'
      : 'Messenger'

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      workspace_id: convo.workspace_id,
      full_name: convo.name || 'Messenger ლიდი',
      source: sourceLabel,
      status: 'new',
      assigned_to: memberId,
      notes: 'შექმნილია Inbox-ის საუბრიდან.',
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('conversations').update({ lead_id: lead.id }).eq('id', convo.id)
  return NextResponse.json({ ok: true, lead_id: lead.id })
}
