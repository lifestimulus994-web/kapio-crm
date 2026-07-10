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

  await admin.from('members').delete().eq('id', id)
  await admin.auth.admin.deleteUser(id)

  return NextResponse.json({ ok: true })
}
