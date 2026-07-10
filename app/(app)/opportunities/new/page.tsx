import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Organization, Contact } from '@/types'
import { STAGES } from '@/types'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function NewOpportunityPage() {
  const [orgsRes, contactsRes] = await Promise.all([
    supabase.from('organizations').select('id, name').order('name'),
    supabase
      .from('contacts')
      .select('id, first_name, last_name')
      .order('first_name'),
  ])

  const orgs = (orgsRes.data ?? []) as Pick<Organization, 'id' | 'name'>[]
  const contacts = (contactsRes.data ?? []) as Pick<
    Contact,
    'id' | 'first_name' | 'last_name'
  >[]

  async function create(formData: FormData) {
    'use server'
    const { error } = await supabase.from('opportunities').insert({
      title: formData.get('title') as string,
      organization_id: (formData.get('organization_id') as string) || null,
      contact_id: (formData.get('contact_id') as string) || null,
      value_gel: parseFloat(formData.get('value_gel') as string) || 0,
      stage: (formData.get('stage') as string) || 'New Lead',
      next_action: (formData.get('next_action') as string) || null,
      pain_points: (formData.get('pain_points') as string) || null,
      notes: (formData.get('notes') as string) || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/')
    redirect('/')
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-slate-100">
            New Opportunity
          </h1>
          <p className="text-xs text-slate-500">Add a deal to your pipeline</p>
        </div>
      </div>

      <form action={create} className="space-y-5">
        {/* Deal info */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Deal
          </h2>
          <div>
            <label className={label}>Title *</label>
            <input
              name="title"
              type="text"
              required
              className={input}
              placeholder="e.g. Website Redesign"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Value (GEL) *</label>
              <input
                name="value_gel"
                type="number"
                min="0"
                step="0.01"
                required
                className={input}
                placeholder="5000"
              />
            </div>
            <div>
              <label className={label}>Stage</label>
              <select name="stage" className={input}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Links */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Link To
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Organization</label>
              <select name="organization_id" className={input}>
                <option value="">— None —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Contact</label>
              <select name="contact_id" className={input}>
                <option value="">— None —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Details */}
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Details
          </h2>
          <div>
            <label className={label}>Next Action</label>
            <input
              name="next_action"
              type="text"
              className={input}
              placeholder="e.g. Send proposal by Friday"
            />
          </div>
          <div>
            <label className={label}>Pain Points</label>
            <textarea
              name="pain_points"
              rows={2}
              className={input + ' resize-none'}
              placeholder="What problems is the client trying to solve?"
            />
          </div>
          <div>
            <label className={label}>Notes</label>
            <textarea
              name="notes"
              rows={2}
              className={input + ' resize-none'}
              placeholder="Additional notes..."
            />
          </div>
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href="/"
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Create Opportunity
          </button>
        </div>
      </form>
    </div>
  )
}
