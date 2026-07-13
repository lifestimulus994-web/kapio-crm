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
  // Approval gate, workspace level: a brand-new self-signup workspace starts
  // 'pending' and stays that way until the super-admin approves it in
  // /admin — blocks EVERY member of it, not just the one who signed up.
  workspace_status: 'pending' | 'approved' | 'rejected'
  // Approval gate, person level: on top of the workspace gate, each
  // individual member — the signing-up owner AND every teammate invited
  // afterward — also starts 'pending' and needs their own approval, even in
  // an already-approved workspace. requireMember() redirects anyone who
  // fails EITHER gate to /pending-approval.
  status: 'pending' | 'approved' | 'rejected'
  invited_by: string | null
}

// Owner and manager see/manage every record in the workspace; a plain
// 'member' only sees records assigned to them (enforced by callers adding
// .eq('assigned_to', member.id) when this is false).
export function hasElevatedAccess(member: Pick<Member, 'role'>): boolean {
  return member.role === 'owner' || member.role === 'manager'
}

// The platform operator (not a workspace owner — the person who runs Kapio
// itself), identified by email via env var so granting this access is a
// Vercel dashboard change, never a DB row an app bug could tamper with.
export function isSuperAdmin(email: string): boolean {
  const allowed = (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase()
  return !!allowed && email.trim().toLowerCase() === allowed
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
    .select('*, workspace:workspaces(plan, status)')
    .eq('id', user.id)
    .single()
  if (!data) return null

  const { workspace, ...member } = data as typeof data & {
    workspace: { plan: string; status: string } | null
  }
  return {
    ...member,
    workspace_plan: workspace?.plan ?? 'starter',
    workspace_status: (workspace?.status ?? 'pending') as Member['workspace_status'],
  } as Member
}

// For Server Components / pages only (redirect() doesn't belong in API routes).
// Also enforces the two-tier approval gate: a member of a pending/rejected
// workspace, OR one whose own row isn't approved yet, never reaches a real
// app page — only /pending-approval.
export async function requireMember(): Promise<Member> {
  const member = await getCurrentMember()
  if (!member) redirect('/login')
  if (member.workspace_status !== 'approved' || member.status !== 'approved') {
    redirect('/pending-approval')
  }
  return member
}

export async function requireOwner(): Promise<Member> {
  const member = await requireMember()
  if (member.role !== 'owner') redirect('/dashboard')
  return member
}
