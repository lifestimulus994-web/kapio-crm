import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ALLOWED = ['todo', 'in_progress', 'done']

// Lightweight status change for a task (used by the calendar/list quick toggle).
// Completion WITH an outcome goes through /api/tasks/complete instead.
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { id?: string; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!body.id || !ALLOWED.includes(body.status ?? '')) {
    return NextResponse.json(
      { error: 'id and a valid status are required.' },
      { status: 400 }
    )
  }
  const { error } = await supabase
    .from('tasks')
    .update({ status: body.status })
    .eq('id', body.id)
    .eq('workspace_id', me.workspace_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
