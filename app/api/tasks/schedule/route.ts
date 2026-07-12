import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
const STATUSES = ['todo', 'in_progress', 'done']

// Schedule / reschedule a task on the calendar.
//  - With `id`: update an existing task's timing (drag-to-move, resize) and/or
//    its other fields. Only the keys you send are changed.
//  - Without `id`: create a new task at the given time (click-on-slot create).
// Timed events use start_at/end_at (ISO timestamps). start_date/due_date are
// kept in sync by the client so the task stays dated. An all-day task sends
// start_date/due_date with start_at/end_at null. (No all_day column is used.)
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const iso = (v: unknown) => {
    const s = str(v)
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const startAt = iso(body.start_at)
  const endAt = iso(body.end_at)

  if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
    return NextResponse.json(
      { error: 'End time must be after the start time.' },
      { status: 400 }
    )
  }

  // Fields shared by create + update. start_at/end_at/start_date/due_date are
  // only applied when the caller sends the key (so null can clear them).
  const buildTiming = (target: Record<string, unknown>) => {
    if ('start_at' in body) target.start_at = startAt
    if ('end_at' in body) target.end_at = endAt
    if ('start_date' in body) target.start_date = str(body.start_date)
    if ('due_date' in body) target.due_date = str(body.due_date)
  }

  const id = str(body.id)

  if (id) {
    // Reschedule / edit an existing task — patch only what was sent.
    const patch: Record<string, unknown> = {}
    buildTiming(patch)
    if (str(body.title)) patch.title = str(body.title)
    if ('description' in body) patch.description = str(body.description)
    if (PRIORITIES.includes(String(body.priority)))
      patch.priority = String(body.priority)
    if (STATUSES.includes(String(body.status))) patch.status = String(body.status)
    if ('owner' in body) patch.owner = str(body.owner)
    if ('organization_id' in body)
      patch.organization_id = str(body.organization_id)
    if ('contact_id' in body) patch.contact_id = str(body.contact_id)
    if ('opportunity_id' in body) patch.opportunity_id = str(body.opportunity_id)

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .eq('workspace_id', me.workspace_id)
      .select('id, title, start_at, end_at, start_date, due_date, status')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, task: data })
  }

  // Create a new task on the calendar.
  const title = str(body.title)
  if (!title) {
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  }
  const insert: Record<string, unknown> = {
    workspace_id: me.workspace_id,
    title,
    description: str(body.description),
    priority: PRIORITIES.includes(String(body.priority))
      ? String(body.priority)
      : 'Medium',
    owner: str(body.owner),
    status: STATUSES.includes(String(body.status)) ? String(body.status) : 'todo',
    organization_id: str(body.organization_id),
    contact_id: str(body.contact_id),
    opportunity_id: str(body.opportunity_id),
  }
  buildTiming(insert)
  const { data, error } = await supabase
    .from('tasks')
    .insert(insert)
    .select('id, title, start_at, end_at, start_date, due_date, status')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, task: data })
}
