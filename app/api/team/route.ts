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

  // user_metadata.invited_workspace_id tells the DB trigger (handle_new_user
  // in schema.sql) to join this new auth user to the inviting owner's
  // workspace as a member, instead of provisioning a brand-new workspace the
  // way a public self-signup would. The trigger is the only writer of the
  // members row for this user — no separate insert here, so there's no
  // duplicate-key race between the two.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      invited_workspace_id: me.workspace_id,
      full_name: full_name || null,
    },
  })

  if (createError || !created.user) {
    const msg = createError?.message ?? 'მომხმარებლის შექმნა ვერ მოხერხდა'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
