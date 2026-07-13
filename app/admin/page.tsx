import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Image from 'next/image'
import { Check, X, ShieldAlert } from 'lucide-react'
import { getCurrentMember, isSuperAdmin } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type OwnerRow = {
  id: string
  email: string
  full_name: string | null
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
    .select('id, email, full_name, created_at, workspace:workspaces(id, name, plan, status, created_at)')
    .eq('role', 'owner')
    .order('created_at', { ascending: false })

  const owners = (data ?? []) as unknown as OwnerRow[]
  const pending = owners.filter((o) => o.workspace?.status === 'pending')
  const rest = owners.filter((o) => o.workspace?.status !== 'pending')

  async function setStatus(formData: FormData) {
    'use server'
    const current = await getCurrentMember()
    if (!current || !isSuperAdmin(current.email)) return
    const workspaceId = formData.get('workspace_id') as string
    const status = formData.get('status') as string
    if (!workspaceId || !['approved', 'rejected', 'pending'].includes(status)) return
    const { error } = await admin.from('workspaces').update({ status }).eq('id', workspaceId)
    if (error) throw new Error(error.message)
    revalidatePath('/admin')
  }

  function Row({ owner }: { owner: OwnerRow }) {
    const ws = owner.workspace
    if (!ws) return null
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-100">{ws.name}</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusChip[ws.status] ?? ''}`}
            >
              {statusLabel[ws.status] ?? ws.status}
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400">
              {planLabel[ws.plan] ?? ws.plan}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {owner.full_name || '—'} · {owner.email}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            რეგისტრირდა {formatDateTime(ws.created_at)}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {ws.status !== 'approved' && (
            <form action={setStatus}>
              <input type="hidden" name="workspace_id" value={ws.id} />
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
          {ws.status !== 'rejected' && (
            <form action={setStatus}>
              <input type="hidden" name="workspace_id" value={ws.id} />
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
            განსახილველი რეგისტრაციები{' '}
            <span className="font-normal text-slate-600">({pending.length})</span>
          </h2>
          <div className="space-y-2.5">
            {pending.map((o) => (
              <Row key={o.id} owner={o} />
            ))}
            {pending.length === 0 && (
              <p className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-600">
                განსახილველი რეგისტრაცია არ არის.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-300">
            ყველა workspace <span className="font-normal text-slate-600">({rest.length})</span>
          </h2>
          <div className="space-y-2.5">
            {rest.map((o) => (
              <Row key={o.id} owner={o} />
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
