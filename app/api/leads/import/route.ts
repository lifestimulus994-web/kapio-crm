import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'

type ImportRow = {
  full_name: string
  phone?: string
  email?: string
  company?: string
  source?: string
  notes?: string
}

export async function POST(request: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { rows?: ImportRow[]; assigned_to?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა' }, { status: 400 })
  }

  const rows = Array.isArray(body.rows) ? body.rows : []
  const valid = rows.filter((r) => r.full_name?.trim())
  if (valid.length === 0) {
    return NextResponse.json({ error: 'დასამატებელი ჩანაწერი არ არის' }, { status: 400 })
  }
  if (valid.length > 500) {
    return NextResponse.json({ error: 'ერთდროულად მაქსიმუმ 500 ლიდი' }, { status: 400 })
  }

  // Only owner/manager may assign a pasted batch straight to a teammate.
  const assignedTo = hasElevatedAccess(me) ? body.assigned_to || null : null

  const { data, error } = await admin
    .from('leads')
    .insert(
      valid.map((r) => ({
        workspace_id: me.workspace_id,
        full_name: r.full_name.trim(),
        phone: r.phone?.trim() || null,
        email: r.email?.trim() || null,
        company: r.company?.trim() || null,
        source: r.source?.trim() || null,
        notes: r.notes?.trim() || null,
        assigned_to: assignedTo,
      }))
    )
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  revalidatePath('/leads')
  return NextResponse.json({ ok: true, imported: data?.length ?? 0 })
}
