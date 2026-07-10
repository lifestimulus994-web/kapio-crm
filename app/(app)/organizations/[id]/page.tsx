import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Organization, Contact, Opportunity, Task } from '@/types'
import {
  ChevronLeft,
  Building2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Hash,
  Pencil,
} from 'lucide-react'
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

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [orgRes, contactsRes, oppsRes, tasksRes, freeContactsRes] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', id).single(),
      supabase
        .from('contacts')
        .select('*')
        .eq('organization_id', id)
        .order('first_name'),
      supabase
        .from('opportunities')
        .select('*')
        .eq('organization_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select('*')
        .eq('organization_id', id)
        .order('due_date'),
      supabase
        .from('contacts')
        .select('id, first_name, last_name')
        .is('organization_id', null)
        .order('first_name'),
    ])

  if (orgRes.error || !orgRes.data) {
    return (
      <div className="p-8 text-red-400 text-sm">Organization not found</div>
    )
  }

  const org = orgRes.data as Organization
  const contacts = (contactsRes.data ?? []) as Contact[]
  const opportunities = (oppsRes.data ?? []) as Opportunity[]
  const tasks = (tasksRes.data ?? []) as Task[]
  const freeContacts = (freeContactsRes.data ?? []) as Pick<
    Contact,
    'id' | 'first_name' | 'last_name'
  >[]

  async function attachContact(formData: FormData) {
    'use server'
    const contactId = formData.get('contact_id') as string
    if (!contactId) return
    const { error } = await supabase
      .from('contacts')
      .update({ organization_id: id })
      .eq('id', contactId)
    if (error) throw new Error(error.message)
    revalidatePath(`/organizations/${id}`)
    revalidatePath('/contacts')
  }

  const info = [
    { Icon: Hash, label: 'ID Code', value: org.identification_code },
    { Icon: Mail, label: 'Email', value: org.email },
    { Icon: Phone, label: 'Phone', value: org.phone },
    { Icon: Globe, label: 'Website', value: org.website ?? '—' },
    { Icon: MapPin, label: 'Address', value: org.address ?? '—' },
    { Icon: Building2, label: 'Industry', value: org.industry ?? '—' },
  ]

  return (
    <div className="px-6 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link
          href="/organizations"
          className="mt-1 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-900/40 flex items-center justify-center text-emerald-400 font-bold text-xl flex-none">
            {org.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{org.name}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{org.legal_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <Link
            href={`/organizations/${id}/edit`}
            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Pencil size={14} />
            Edit
          </Link>
          <Link
            href="/opportunities/new"
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Opportunity
          </Link>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-6">
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

      {/* Linked data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Contacts */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-slate-300">
              Contacts{' '}
              <span className="text-slate-600 font-normal">
                ({contacts.length})
              </span>
            </h2>
            <Link
              href={`/contacts/new?org=${id}`}
              className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              + Add
            </Link>
          </div>

          {/* Attach an existing contact */}
          {freeContacts.length > 0 && (
            <form action={attachContact} className="flex gap-2 mb-2">
              <select
                name="contact_id"
                defaultValue=""
                className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              >
                <option value="" disabled>
                  Link existing contact…
                </option>
                {freeContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fullName(c)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors flex-none"
              >
                Link
              </button>
            </form>
          )}

          <div className="space-y-2">
            {contacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-slate-600 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300 flex-none">
                  {c.first_name.charAt(0)}
                  {c.last_name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-200">{fullName(c)}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {c.job_title ?? c.email ?? '—'}
                  </p>
                </div>
              </Link>
            ))}
            {contacts.length === 0 && (
              <p className="text-xs text-slate-700 py-5 text-center">
                No contacts yet
              </p>
            )}
          </div>
        </div>

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
      </div>

      {/* Tasks */}
      <div className="mt-5">
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
            <p className="text-xs text-slate-700 py-5 text-center">No tasks</p>
          )}
        </div>
      </div>

      {org.notes && (
        <div className="mt-5 bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-2">Notes</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {org.notes}
          </p>
        </div>
      )}
    </div>
  )
}