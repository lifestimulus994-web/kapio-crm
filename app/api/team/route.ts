import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'

export async function POST(request: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  if (me.role !== 'owner') {
    return NextResponse.json({ error: 'მხოლოდ owner-ს შეუძლია წევრის დამატება' }, { status: 403 })
  }

  const { email, password, full_name } = await request.json()

  if (!email || !password || String(password).length < 6) {
    return NextResponse.json(
      { error: 'ელფოსტა და მინიმუმ 6-სიმბოლოიანი პაროლი საჭიროა' },
      { status: 400 }
    )
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created.user) {
    const msg = createError?.message ?? 'მომხმარებლის შექმნა ვერ მოხერხდა'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { error: memberError } = await admin.from('members').insert({
    id: created.user.id,
    email,
    full_name: full_name || null,
    role: 'member',
  })

  if (memberError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: memberError.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
