import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Contact, Organization } from '@/types'
import { ChevronLeft, Trash2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [contactRes, orgsRes] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase.from('organizations').select('id, name').order('name'),
  ])

  if (contactRes.error || !contactRes.data) {
    return <div className="p-8 text-red-400 text-sm">Contact not found</div>
  }

  const contact = contactRes.data as Contact
  const orgs = (orgsRes.data ?? []) as Pick<Organization, 'id' | 'name'>[]

  async function update(formData: FormData) {
    'use server'
    const { error } = await supabase
      .from('contacts')
      .update({
        first_name: formData.get('first_name') as string,
        last_name: formData.get('last_name') as string,
        organization_id: (formData.get('organization_id') as string) || null,
        job_title: (formData.get('job_title') as string) || null,
        email: (formData.get('email') as string) || null,
        phone: (formData.get('phone') as string) || null,
        notes: (formData.get('notes') as string) || null,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/contacts')
    revalidatePath(`/contacts/${id}`)
    redirect(`/contacts/${id}`)
  }

  async function remove() {
    'use server'
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/contacts')
    redirect('/contacts')
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href={`/contacts/${id}`}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-slate-100">
            Edit Contact
          </h1>
          <p className="text-xs text-slate-500">
            {`${contact.first_name} ${contact.last_name}`.trim()}
          </p>
        </div>
        <form action={remove}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 px-3 py-2 rounded-lg transition-colors"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </form>
      </div>

      <form action={update} className="space-y-5">
        {/* Personal */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Personal Information
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>First Name *</label>
              <input
                name="first_name"
                type="text"
                required
                defaultValue={contact.first_name}
                className={input}
                placeholder="Giorgi"
              />
            </div>
            <div>
              <label className={label}>Last Name *</label>
              <input
                name="last_name"
                type="text"
                required
                defaultValue={contact.last_name}
                className={input}
                placeholder="Beridze"
              />
            </div>
            <div>
              <label className={label}>Job Title</label>
              <input
                name="job_title"
                type="text"
                defaultValue={contact.job_title ?? ''}
                className={input}
                placeholder="CEO, Sales Manager..."
              />
            </div>
            <div>
              <label className={label}>Organization</label>
              <select
                name="organization_id"
                defaultValue={contact.organization_id ?? ''}
                className={input}
              >
                <option value="">— No organization —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Contact details */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Contact Details
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Email</label>
              <input
                name="email"
                type="email"
                defaultValue={contact.email ?? ''}
                className={input}
                placeholder="giorgi@company.ge"
              />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input
                name="phone"
                type="tel"
                defaultValue={contact.phone ?? ''}
                className={input}
                placeholder="+995 5XX XXX XXX"
              />
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5">
          <label className={label}>Notes</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={contact.notes ?? ''}
            className={input + ' resize-none'}
            placeholder="Additional notes about this person..."
          />
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href={`/contacts/${id}`}
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Save Changes
          </button>
        </div>
      </form>
    </div>
  )
}
