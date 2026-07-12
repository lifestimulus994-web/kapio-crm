import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabase as admin } from '@/lib/supabase'

export type Member = {
  id: string
  workspace_id: string
  email: string
  full_name: string | null
  role: 'owner' | 'member'
  created_at: string
}

// No redirect — safe to call from API routes.
export async function getCurrentMember(): Promise<Member | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await admin.from('members').select('*').eq('id', user.id).single()
  return (data as Member) ?? null
}

// For Server Components / pages only (redirect() doesn't belong in API routes).
export async function requireMember(): Promise<Member> {
  const member = await getCurrentMember()
  if (!member) redirect('/login')
  return member
}

export async function requireOwner(): Promise<Member> {
  const member = await requireMember()
  if (member.role !== 'owner') redirect('/dashboard')
  return member
}
