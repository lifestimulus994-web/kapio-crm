import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Image from 'next/image'
import { Check, X, ShieldAlert } from 'lucide-react'
import { getCurrentMember, isSuperAdmin } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type MemberRow = {
  id: string
  email: string
  full_name: string | null
  role: string
  status: 'pending' | 'approved' | 'rejected'
  invited_by: string | null
  created_at: string
  workspace: {
    id: string
    name: string
    plan: string
    status: 'pending' | 'approved' | 'rejected'
    created_at: string
  } | null
}

const planLabel: Record<string, string> = {
  starter: 'Starter',
  business: 'Business',
  pro: 'Pro',
}

const statusChip: Record<string, string> = {
  pending: 'bg-amber-950/40 text-amber-400 border-amber-800/60',
  approved: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60',
  rejected: 'bg-red-950/40 text-red-400 border-red-800/60',
}

const statusLabel: Record<string, string> = {
  pending: 'განხილვაშია',
  approved: 'დამტკიცებული',
  rejected: 'უარყოფილი',
}

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  member: 'Member',
}

export default async function AdminPage() {
  const me = await getCurrentMember()
  if (!me) redirect('/login')
  if (!isSuperAdmin(me.email)) redirect('/dashboard')

  // The one deliberately cross-tenant query in the whole app — every other
  // page filters by workspace_id. Safe only because this route itself is
  // gated by isSuperAdmin() above, checked against a Vercel env var, not a
  // DB row an app bug could tamper with.
  const { data } = await admin
    .from('members')
    .select(
      'id, email, full_name, role, status, invited_by, created_at, workspace:workspaces(id, name, plan, status, created_at)'
    )
    .order('created_at', { ascending: false })

  const members = (data ?? []) as unknown as MemberRow[]
  const byId = new Map(members.map((m) => [m.id, m]))

  const pending = members.filter((m) => m.status === 'pending' || m.workspace?.status === 'pending')
  const rest = members.filter((m) => m.status !== 'pending' && m.workspace?.status !== 'pending')

  async function setMemberStatus(formData: FormData) {
    'use server'
    const current = await getCurrentMember()
    if (!current || !isSuperAdmin(current.email)) return
    const memberId = formData.get('member_id') as string
    const workspaceId = formData.get('workspace_id') as string
    const status = formData.get('status') as string
    if (!memberId || !['approved', 'rejected', 'pending'].includes(status)) return

    const { error } = await admin.from('members').update({ status }).eq('id', memberId)
    if (error) throw new Error(error.message)

    // Approving an owner's row also approves their workspace in the same
    // click — a brand-new signup is otherwise gated twice for no reason,
    // since nobody else can be in that workspace yet anyway.
    if (status === 'approved' && workspaceId) {
      await admin
        .from('workspaces')
        .update({ status: 'approved' })
        .eq('id', workspaceId)
        .eq('status', 'pending')
    }
    revalidatePath('/admin')
  }

  function Row({ m }: { m: MemberRow }) {
    const ws = m.workspace
    const inviter = m.invited_by ? byId.get(m.invited_by) : null
    const effectiveStatus: 'pending' | 'approved' | 'rejected' =
      ws?.status === 'pending' ? 'pending' : m.status
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-100">
              {m.full_name || m.email}
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusChip[effectiveStatus] ?? ''}`}
            >
              {statusLabel[effectiveStatus] ?? effectiveStatus}
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400">
              {roleLabel[m.role] ?? m.role}
            </span>
            {ws && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                {planLabel[ws.plan] ?? ws.plan}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {m.email} {ws && <>· {ws.name}</>}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            {m.role === 'owner' ? 'თავად დარეგისტრირდა' : inviter ? `დაამატა ${inviter.full_name || inviter.email}` : 'ვინ დაამატა უცნობია'}
            {' · '}
            {formatDateTime(m.created_at)}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {effectiveStatus !== 'approved' && (
            <form action={setMemberStatus}>
              <input type="hidden" name="member_id" value={m.id} />
              <input type="hidden" name="workspace_id" value={ws?.id ?? ''} />
              <input type="hidden" name="status" value="approved" />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                <Check size={13} />
                დადასტურება
              </button>
            </form>
          )}
          {effectiveStatus !== 'rejected' && (
            <form action={setMemberStatus}>
              <input type="hidden" name="member_id" value={m.id} />
              <input type="hidden" name="workspace_id" value={ws?.id ?? ''} />
              <input type="hidden" name="status" value="rejected" />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-950/40"
              >
                <X size={13} />
                უარყოფა
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2.5">
          <Image src="/logo.png" alt="Kapio" width={28} height={28} className="rounded-lg" />
          <span className="text-lg font-semibold text-slate-100">Kapio Admin</span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-500">
            <ShieldAlert size={13} />
            მხოლოდ super-admin
          </span>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-slate-300">
            განსახილველი (workspace-ები და წევრები){' '}
            <span className="font-normal text-slate-600">({pending.length})</span>
          </h2>
          <div className="space-y-2.5">
            {pending.map((m) => (
              <Row key={m.id} m={m} />
            ))}
            {pending.length === 0 && (
              <p className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-600">
                განსახილველი არაფერია.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-300">
            ყველა მომხმარებელი <span className="font-normal text-slate-600">({rest.length})</span>
          </h2>
          <div className="space-y-2.5">
            {rest.map((m) => (
              <Row key={m.id} m={m} />
            ))}
            {rest.length === 0 && (
              <p className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-600">
                არაფერია აქ ჯერ.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
