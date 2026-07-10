import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Organization } from '@/types'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>
}) {
  const { org: preselectedOrg } = await searchParams

  const { data: orgsData } = await supabase
    .from('organizations')
    .select('id, name')
    .order('name')

  const orgs = (orgsData ?? []) as Pick<Organization, 'id' | 'name'>[]

  async function create(formData: FormData) {
    'use server'
    const { error } = await supabase.from('contacts').insert({
      first_name: formData.get('first_name') as string,
      last_name: formData.get('last_name') as string,
      organization_id: (formData.get('organization_id') as string) || null,
      job_title: (formData.get('job_title') as string) || null,
      email: (formData.get('email') as string) || null,
      phone: (formData.get('phone') as string) || null,
      notes: (formData.get('notes') as string) || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/contacts')
    redirect('/contacts')
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/contacts"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-slate-100">
            New Contact
          </h1>
          <p className="text-xs text-slate-500">
            Add a person to your CRM
          </p>
        </div>
      </div>

      <form action={create} className="space-y-5">
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
                className={input}
                placeholder="Beridze"
              />
            </div>
            <div>
              <label className={label}>Job Title</label>
              <input
                name="job_title"
                type="text"
                className={input}
                placeholder="CEO, Sales Manager..."
              />
            </div>
            <div>
              <label className={label}>Organization</label>
              <select
                name="organization_id"
                defaultValue={preselectedOrg ?? ''}
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
                className={input}
                placeholder="giorgi@company.ge"
              />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input
                name="phone"
                type="tel"
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
            className={input + ' resize-none'}
            placeholder="Additional notes about this person..."
          />
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href="/contacts"
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Create Contact
          </button>
        </div>
      </form>
    </div>
  )
}
