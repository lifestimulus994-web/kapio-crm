import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Strategy boards are workspace-shared: every member of the workspace can
// see and edit every board, so scoping is by workspace_id only (no
// per-member assigned_to filtering like tasks/leads).

export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — creates with defaults
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : 'ახალი დაფა'

  const { data, error } = await supabase
    .from('boards')
    .insert({ workspace_id: me.workspace_id, created_by: me.id, name })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, board: data })
}

export async function PATCH(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'Board id is required.' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (body.data && typeof body.data === 'object') patch.data = body.data
  if (Object.keys(patch).length === 1)
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const { error } = await supabase
    .from('boards')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', me.workspace_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : null
  if (!id) return NextResponse.json({ error: 'Board id is required.' }, { status: 400 })

  const { error } = await supabase
    .from('boards')
    .delete()
    .eq('id', id)
    .eq('workspace_id', me.workspace_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
