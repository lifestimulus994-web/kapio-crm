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
    .select(
      'ai_enabled, knowledge, tone, booking_enabled, consult_minutes, work_days, work_start, work_end, buffer_minutes, min_notice_hours'
    )
    .eq('workspace_id', me.workspace_id)
    .maybeSingle()

  return NextResponse.json({
    ai_enabled: data?.ai_enabled ?? false,
    knowledge: data?.knowledge ?? '',
    tone: data?.tone ?? '',
    booking_enabled: data?.booking_enabled ?? false,
    consult_minutes: data?.consult_minutes ?? 30,
    work_days: data?.work_days ?? '1,2,3,4,5',
    work_start: data?.work_start ?? '10:00',
    work_end: data?.work_end ?? '19:00',
    buffer_minutes: data?.buffer_minutes ?? 0,
    min_notice_hours: data?.min_notice_hours ?? 2,
  })
}

export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: {
    ai_enabled?: boolean
    knowledge?: string
    tone?: string
    booking_enabled?: boolean
    consult_minutes?: number
    work_days?: string
    work_start?: string
    work_end?: string
    buffer_minutes?: number
    min_notice_hours?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  const newKnowledge = typeof body.knowledge === 'string' ? body.knowledge : ''
  const newTone = typeof body.tone === 'string' ? body.tone : ''

  // Snapshot the PREVIOUS knowledge/tone into history before overwriting, so a
  // bad edit can be rolled back. Only when something actually changed.
  const { data: prev } = await supabase
    .from('inbox_settings')
    .select('knowledge, tone')
    .eq('workspace_id', me.workspace_id)
    .maybeSingle()
  if (prev && (prev.knowledge !== newKnowledge || prev.tone !== newTone) && (prev.knowledge || prev.tone)) {
    await supabase.from('knowledge_versions').insert({
      workspace_id: me.workspace_id,
      knowledge: prev.knowledge ?? '',
      tone: prev.tone ?? '',
      saved_by: me.id,
    })
  }

  const row: Record<string, unknown> = {
    workspace_id: me.workspace_id,
    ai_enabled: !!body.ai_enabled,
    knowledge: newKnowledge,
    tone: newTone,
    updated_at: new Date().toISOString(),
  }
  // Booking config (only overwrite when provided, so a plain AI save doesn't reset it).
  if (typeof body.booking_enabled === 'boolean') row.booking_enabled = body.booking_enabled
  if (typeof body.consult_minutes === 'number') row.consult_minutes = body.consult_minutes
  if (typeof body.work_days === 'string') row.work_days = body.work_days
  if (typeof body.work_start === 'string') row.work_start = body.work_start
  if (typeof body.work_end === 'string') row.work_end = body.work_end
  if (typeof body.buffer_minutes === 'number') row.buffer_minutes = body.buffer_minutes
  if (typeof body.min_notice_hours === 'number') row.min_notice_hours = body.min_notice_hours

  const { error } = await supabase.from('inbox_settings').upsert(row, { onConflict: 'workspace_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
