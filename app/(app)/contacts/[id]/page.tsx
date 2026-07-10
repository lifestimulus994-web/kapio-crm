import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Contact, Opportunity, Organization, Task } from '@/types'
import { ChevronLeft, Mail, Phone, Briefcase, Building2, Pencil } from 'lucide-react'
import { formatCurrency, formatDate, fullName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const stageChip: Record<string, string> = {
  'New Lead': 'bg-slate-700/80 text-slate-300',
  Contacted: 'bg-blue-900/50 text-blue-400',
  'Needs Identified': 'bg-violet-900/50 text-violet-400',
  'Proposal Sent': 'bg-amber-900/50 text-amber-400',
  Negotiation: 'bg-orange-900/50 text-orange-400',
  Won: 'bg-emerald-900/50 text-emerald-400',
  Lost: 'bg-red-900/50 text-red-400',
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [contactRes, oppsRes, tasksRes, orgsRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('*, organization:organizations(id, name)')
      .eq('id', id)
      .single(),
    supabase
      .from('opportunities')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .eq('contact_id', id)
      .order('due_date'),
    supabase.from('organizations').select('id, name').order('name'),
  ])

  if (contactRes.error || !contactRes.data) {
    return <div className="p-8 text-red-400 text-sm">Contact not found</div>
  }

  const contact = contactRes.data as Contact
  const opportunities = (oppsRes.data ?? []) as Opportunity[]
  const tasks = (tasksRes.data ?? []) as Task[]
  const orgs = (orgsRes.data ?? []) as Pick<Organization, 'id' | 'name'>[]

  async function updateOrganization(formData: FormData) {
    'use server'
    const { error } = await supabase
      .from('contacts')
      .update({
        organization_id: (formData.get('organization_id') as string) || null,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(`/contacts/${id}`)
    revalidatePath('/contacts')
  }

  const info = [
    { Icon: Mail, label: 'Email', value: contact.email ?? '—' },
    { Icon: Phone, label: 'Phone', value: contact.phone ?? '—' },
    { Icon: Briefcase, label: 'Title', value: contact.job_title ?? '—' },
  ]

  return (
    <div className="px-6 py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/contacts"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-lg font-semibold text-slate-200 flex-none">
          {contact.first_name.charAt(0)}
          {contact.last_name.charAt(0)}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-100">
            {fullName(contact)}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {contact.job_title ?? '—'}
            {contact.organization?.name
              ? ` · ${contact.organization.name}`
              : ''}
          </p>
        </div>
        <Link
          href={`/contacts/${id}/edit`}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-none"
        >
          <Pencil size={14} />
          Edit
        </Link>
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

        {/* Editable Company link */}
        <form
          action={updateOrganization}
          className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Building2 size={12} className="text-slate-600" />
            <span className="text-xs text-slate-500">Company</span>
          </div>
          <select
            name="organization_id"
            defaultValue={contact.organization_id ?? ''}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
          >
            <option value="">— No company —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="mt-2 w-full py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Save
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Opportunities */}
        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Opportunities{' '}
            <span className="text-slate-600 font-normal">
              ({opportunities.length})
            </span>
          </h2>
          <div className="space-y-2">
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-200 leading-snug">
                    {opp.title}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full flex-none ${stageChip[opp.stage] ?? 'bg-slate-700 text-slate-400'}`}
                  >
                    {opp.stage}
                  </span>
                </div>
                <p className="text-sm font-bold text-emerald-400 mt-1.5">
                  {formatCurrency(Number(opp.value_gel))}
                </p>
              </div>
            ))}
            {opportunities.length === 0 && (
              <p className="text-xs text-slate-700 py-5 text-center">
                No opportunities
              </p>
            )}
          </div>
        </div>

        {/* Tasks */}
        <div>
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Tasks{' '}
            <span className="text-slate-600 font-normal">({tasks.length})</span>
          </h2>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/60"
              >
                <div
                  className={`w-2 h-2 rounded-full flex-none ${
                    task.status === 'done'
                      ? 'bg-emerald-500'
                      : task.status === 'in_progress'
                        ? 'bg-amber-500'
                        : 'bg-slate-600'
                  }`}
                />
                <p
                  className={`text-sm flex-1 ${task.status === 'done' ? 'line-through text-slate-600' : 'text-slate-300'}`}
                >
                  {task.title}
                </p>
                {task.due_date && (
                  <span className="text-xs text-slate-600 flex-none">
                    {formatDate(task.due_date)}
                  </span>
                )}
              </div>
            ))}
            {tasks.length === 0 && (
              <p className="text-xs text-slate-700 py-5 text-center">
                No tasks
              </p>
            )}
          </div>
        </div>
      </div>

      {contact.notes && (
        <div className="mt-5 bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-2">Notes</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {contact.notes}
          </p>
        </div>
      )}
    </div>
  )
}