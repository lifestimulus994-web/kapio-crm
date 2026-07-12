import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  if (me.role !== 'owner') {
    return NextResponse.json({ error: 'მხოლოდ owner-ს შეუძლია წევრის წაშლა' }, { status: 403 })
  }

  const { id } = await params
  if (id === me.id) {
    return NextResponse.json({ error: 'საკუთარი თავის წაშლა არ შეიძლება' }, { status: 400 })
  }

  // Confirm the target member is actually in the caller's own workspace
  // before touching anything — an owner must not be able to delete another
  // workspace's member by id.
  const { data: target } = await admin
    .from('members')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', me.workspace_id)
    .maybeSingle()
  if (!target) {
    return NextResponse.json({ error: 'წევრი ვერ მოიძებნა' }, { status: 404 })
  }

  await admin.from('members').delete().eq('id', id).eq('workspace_id', me.workspace_id)
  await admin.auth.admin.deleteUser(id)

  return NextResponse.json({ ok: true })
}
