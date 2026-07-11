import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import { LEAD_STATUSES, type Lead } from '@/types'
import { ChevronLeft, Mail, Phone, Building2, Megaphone } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const statusChip: Record<string, string> = {
  new: 'bg-slate-700/80 text-slate-300',
  contacted: 'bg-blue-900/50 text-blue-400',
  converted: 'bg-emerald-900/50 text-emerald-400',
  lost: 'bg-red-900/50 text-red-400',
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await requireMember()
  const isOwner = me.role === 'owner'

  let leadQuery = supabase
    .from('leads')
    .select('*, assignee:members(id, full_name, email)')
    .eq('id', id)

  if (!isOwner) {
    leadQuery = leadQuery.eq('assigned_to', me.id)
  }

  const [leadRes, membersRes] = await Promise.all([
    leadQuery.single(),
    isOwner
      ? supabase.from('members').select('id, full_name, email').order('full_name')
      : Promise.resolve({ data: null, error: null }),
  ])

  if (leadRes.error || !leadRes.data) {
    return <div className="p-8 text-red-400 text-sm">Lead not found</div>
  }

  const lead = leadRes.data as Lead
  const members = (membersRes.data ?? []) as { id: string; full_name: string | null; email: string }[]

  async function assign(formData: FormData) {
    'use server'
    const current = await requireMember()
    if (current.role !== 'owner') return
    const assignedTo = (formData.get('assigned_to') as string) || null
    const { error } = await supabase.from('leads').update({ assigned_to: assignedTo }).eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(`/leads/${id}`)
    revalidatePath('/leads')
  }

  async function setStatus(formData: FormData) {
    'use server'
    const status = formData.get('status') as string
    if (!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) return
    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(`/leads/${id}`)
    revalidatePath('/leads')
  }

  const info = [
    { Icon: Mail, label: 'Email', value: lead.email ?? '—' },
    { Icon: Phone, label: 'Phone', value: lead.phone ?? '—' },
    { Icon: Building2, label: 'Company', value: lead.company ?? '—' },
    { Icon: Megaphone, label: 'Source', value: lead.source ?? '—' },
  ]

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/leads"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-semibold text-slate-200 flex-none">
          {lead.full_name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-100">{lead.full_name}</h1>
          <p className="mt-0.5 inline-flex items-center gap-2 text-xs text-slate-500">
            <span className={`px-2 py-0.5 rounded-full ${statusChip[lead.status] ?? 'bg-slate-700 text-slate-300'}`}>
              {lead.status}
            </span>
            <span>Added {formatDateTime(lead.created_at)}</span>
          </p>
        </div>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-6">
        {info.map(({ Icon, label, value }) => (
          <div
            key={label}
            className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon size={12} className="text-slate-600" />
              <span className="text-xs text-slate-500">{label}</span>
            </div>
            <p className="text-sm text-slate-200 truncate">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
        {/* Status control (everyone) */}
        <form
          action={setStatus}
          className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5"
        >
          <label className="mb-1.5 block text-xs text-slate-500">Status</label>
          <div className="flex gap-2">
            <select
              name="status"
              defaultValue={lead.status}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex-none"
            >
              Save
            </button>
          </div>
        </form>

        {/* Assignment (owner only) */}
        {isOwner && (
          <form
            action={assign}
            className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5"
          >
            <label className="mb-1.5 block text-xs text-slate-500">Assigned to</label>
            <div className="flex gap-2">
              <select
                name="assigned_to"
                defaultValue={lead.assigned_to ?? ''}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex-none"
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {lead.notes && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-2">Notes</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {lead.notes}
          </p>
        </div>
      )}
    </div>
  )
}
