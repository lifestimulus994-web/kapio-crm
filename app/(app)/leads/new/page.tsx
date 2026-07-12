import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember, hasElevatedAccess } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'
import PasteImport from '@/components/leads/PasteImport'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function NewLeadPage() {
  const me = await requireMember()
  const isOwner = hasElevatedAccess(me)

  const { data: membersData } = isOwner
    ? await supabase
        .from('members')
        .select('id, full_name, email')
        .eq('workspace_id', me.workspace_id)
        .order('full_name')
    : { data: null }
  const members = (membersData ?? []) as { id: string; full_name: string | null; email: string }[]

  async function create(formData: FormData) {
    'use server'
    const owner = await requireMember()
    const { error } = await supabase.from('leads').insert({
      workspace_id: owner.workspace_id,
      full_name: formData.get('full_name') as string,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      company: (formData.get('company') as string) || null,
      source: (formData.get('source') as string) || null,
      notes: (formData.get('notes') as string) || null,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/leads')
    redirect('/leads')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/leads"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-slate-100">New Lead</h1>
          <p className="text-xs text-slate-500">Add an incoming lead — distribute it once it&apos;s added</p>
        </div>
      </div>

      <form action={create} className="space-y-5">
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Lead Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Full Name *</label>
              <input
                name="full_name"
                type="text"
                required
                className={input}
                placeholder="Giorgi Beridze"
              />
            </div>
            <div>
              <label className={label}>Company</label>
              <input
                name="company"
                type="text"
                className={input}
                placeholder="TBC Bank"
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
              <label className={label}>Source</label>
              <input
                name="source"
                type="text"
                className={input}
                placeholder="Facebook ad, referral, website form..."
              />
            </div>
          </div>
        </section>

        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5">
          <label className={label}>Notes</label>
          <textarea
            name="notes"
            rows={3}
            className={input + ' resize-none'}
            placeholder="Anything else about this lead..."
          />
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href="/leads"
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Create Lead
          </button>
        </div>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-slate-600">
        <div className="h-px flex-1 bg-slate-800" />
        OR
        <div className="h-px flex-1 bg-slate-800" />
      </div>

      <PasteImport isOwner={isOwner} members={members} />
    </div>
  )
}
