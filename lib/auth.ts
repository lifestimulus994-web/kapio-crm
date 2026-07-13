import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabase as admin } from '@/lib/supabase'

export type Member = {
  id: string
  workspace_id: string
  email: string
  full_name: string | null
  role: 'owner' | 'manager' | 'member'
  created_at: string
  // The workspace's plan (starter/business/pro) — used to gate AI spend
  // limits (lib/ai-usage.ts). Flattened from a join, not its own column.
  workspace_plan: string
}

// Owner and manager see/manage every record in the workspace; a plain
// 'member' only sees records assigned to them (enforced by callers adding
// .eq('assigned_to', member.id) when this is false).
export function hasElevatedAccess(member: Pick<Member, 'role'>): boolean {
  return member.role === 'owner' || member.role === 'manager'
}

// No redirect — safe to call from API routes.
export async function getCurrentMember(): Promise<Member | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await admin
    .from('members')
    .select('*, workspace:workspaces(plan)')
    .eq('id', user.id)
    .single()
  if (!data) return null

  const { workspace, ...member } = data as typeof data & {
    workspace: { plan: string } | null
  }
  return { ...member, workspace_plan: workspace?.plan ?? 'starter' } as Member
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
