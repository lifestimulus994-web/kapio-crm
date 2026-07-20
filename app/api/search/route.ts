import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Global search for the top bar. Matches by name across contacts,
// organizations, leads and opportunities in the member's workspace. A plain
// member only sees records assigned to them; owner/manager see everything.
export async function GET(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ results: [] })

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  const elevated = hasElevatedAccess(me)
  const like = `%${q}%`
  const results: { type: string; label: string; sub: string | null; link: string }[] = []

  // Helper: apply workspace + (for plain members) assigned_to scoping.
  const scoped = <T extends { eq: (c: string, v: unknown) => T }>(query: T): T => {
    let x = query.eq('workspace_id', me.workspace_id)
    if (!elevated) x = x.eq('assigned_to', me.id)
    return x
  }

  const [contacts, orgs, leads, opps] = await Promise.all([
    scoped(
      supabase
        .from('contacts')
        .select('id, first_name, last_name, email')
        .or(`first_name.ilike.${like},last_name.ilike.${like}`)
        .limit(5)
    ),
    scoped(supabase.from('organizations').select('id, name, industry').ilike('name', like).limit(5)),
    scoped(supabase.from('leads').select('id, full_name, company').ilike('full_name', like).limit(5)),
    scoped(supabase.from('opportunities').select('id, title, stage').ilike('title', like).limit(5)),
  ])

  for (const c of contacts.data ?? [])
    results.push({
      type: 'კონტაქტი',
      label: `${c.first_name} ${c.last_name ?? ''}`.trim(),
      sub: c.email ?? null,
      link: `/contacts`,
    })
  for (const o of orgs.data ?? [])
    results.push({ type: 'ორგანიზაცია', label: o.name, sub: o.industry ?? null, link: `/organizations` })
  for (const l of leads.data ?? [])
    results.push({ type: 'ლიდი', label: l.full_name, sub: l.company ?? null, link: `/leads` })
  for (const op of opps.data ?? [])
    results.push({ type: 'შესაძლებლობა', label: op.title, sub: op.stage ?? null, link: `/dashboard` })

  return NextResponse.json({ results })
}
