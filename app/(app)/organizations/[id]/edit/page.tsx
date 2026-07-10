import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Organization } from '@/types'
import { ChevronLeft, Trash2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return <div className="p-8 text-red-400 text-sm">Organization not found</div>
  }

  const org = data as Organization

  async function update(formData: FormData) {
    'use server'
    const { error } = await supabase
      .from('organizations')
      .update({
        name: formData.get('name') as string,
        legal_name: formData.get('legal_name') as string,
        identification_code: formData.get('identification_code') as string,
        email: formData.get('email') as string,
        phone: formData.get('phone') as string,
        industry: (formData.get('industry') as string) || null,
        website: (formData.get('website') as string) || null,
        address: (formData.get('address') as string) || null,
        notes: (formData.get('notes') as string) || null,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/organizations')
    revalidatePath(`/organizations/${id}`)
    redirect(`/organizations/${id}`)
  }

  async function remove() {
    'use server'
    const { error } = await supabase.from('organizations').delete().eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/organizations')
    redirect('/organizations')
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href={`/organizations/${id}`}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-slate-100">
            Edit Organization
          </h1>
          <p className="text-xs text-slate-500">{org.name}</p>
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
        {/* Company */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Company
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={label}>Display Name *</label>
              <input
                name="name"
                type="text"
                required
                defaultValue={org.name}
                className={input}
                placeholder="e.g. Kapio"
              />
            </div>
            <div className="col-span-2">
              <label className={label}>Legal Name (შპს) *</label>
              <input
                name="legal_name"
                type="text"
                required
                defaultValue={org.legal_name}
                className={input}
                placeholder="შპს კაპიო"
              />
            </div>
            <div>
              <label className={label}>Identification Code *</label>
              <input
                name="identification_code"
                type="text"
                required
                defaultValue={org.identification_code}
                className={input}
                placeholder="საიდენტიფიკაციო კოდი"
              />
            </div>
            <div>
              <label className={label}>Industry</label>
              <input
                name="industry"
                type="text"
                defaultValue={org.industry ?? ''}
                className={input}
                placeholder="Technology, Finance..."
              />
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Contact Details
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Email *</label>
              <input
                name="email"
                type="email"
                required
                defaultValue={org.email}
                className={input}
                placeholder="info@company.ge"
              />
            </div>
            <div>
              <label className={label}>Phone *</label>
              <input
                name="phone"
                type="tel"
                required
                defaultValue={org.phone}
                className={input}
                placeholder="+995 32 2..."
              />
            </div>
            <div>
              <label className={label}>Website</label>
              <input
                name="website"
                type="url"
                defaultValue={org.website ?? ''}
                className={input}
                placeholder="https://company.ge"
              />
            </div>
            <div>
              <label className={label}>Address</label>
              <input
                name="address"
                type="text"
                defaultValue={org.address ?? ''}
                className={input}
                placeholder="Tbilisi, Georgia"
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
            defaultValue={org.notes ?? ''}
            className={input + ' resize-none'}
            placeholder="Additional notes..."
          />
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href={`/organizations/${id}`}
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
