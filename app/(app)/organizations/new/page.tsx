import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember, hasElevatedAccess } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function NewOrganizationPage() {
  const me = await requireMember()
  const elevated = hasElevatedAccess(me)

  const members = elevated
    ? (
        await supabase
          .from('members')
          .select('id, full_name, email')
          .eq('workspace_id', me.workspace_id)
          .order('full_name')
      ).data ?? []
    : []

  async function create(formData: FormData) {
    'use server'
    const me = await requireMember()
    const elevated = hasElevatedAccess(me)
    const assignedTo = elevated
      ? (formData.get('assigned_to') as string) || null
      : me.id
    const { error } = await supabase.from('organizations').insert({
      workspace_id: me.workspace_id,
      name: formData.get('name') as string,
      legal_name: formData.get('legal_name') as string,
      identification_code: formData.get('identification_code') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      industry: (formData.get('industry') as string) || null,
      website: (formData.get('website') as string) || null,
      address: (formData.get('address') as string) || null,
      notes: (formData.get('notes') as string) || null,
      assigned_to: assignedTo,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/organizations')
    redirect('/organizations')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/organizations"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-slate-100">
            New Organization
          </h1>
          <p className="text-xs text-slate-500">Add a company to your CRM</p>
        </div>
      </div>

      <form action={create} className="space-y-5">
        {/* Company */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Company
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={label}>Display Name *</label>
              <input
                name="name"
                type="text"
                required
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
                className={input}
                placeholder="საიდენტიფიკაციო კოდი"
              />
            </div>
            <div>
              <label className={label}>Industry</label>
              <input
                name="industry"
                type="text"
                className={input}
                placeholder="Technology, Finance..."
              />
            </div>
            {elevated && (
              <div>
                <label className={label}>Assigned to</label>
                <select name="assigned_to" defaultValue={me.id} className={input}>
                  <option value="">— Unassigned —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Contact */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Contact Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Email *</label>
              <input
                name="email"
                type="email"
                required
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
                className={input}
                placeholder="+995 32 2..."
              />
            </div>
            <div>
              <label className={label}>Website</label>
              <input
                name="website"
                type="url"
                className={input}
                placeholder="https://company.ge"
              />
            </div>
            <div>
              <label className={label}>Address</label>
              <input
                name="address"
                type="text"
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
            className={input + ' resize-none'}
            placeholder="Additional notes..."
          />
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href="/organizations"
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Create Organization
          </button>
        </div>
      </form>
    </div>
  )
}
