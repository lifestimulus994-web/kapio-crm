import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import type { Organization, Contact, Opportunity } from '@/types'
import { TASK_PRIORITIES } from '@/types'
import { ChevronLeft } from 'lucide-react'
import { fullName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const input =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-500/50 transition-colors'
const label = 'block text-xs font-medium text-slate-400 mb-1.5'

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string; org?: string; contact?: string }>
}) {
  const sp = await searchParams
  const me = await requireMember()

  const [orgsRes, contactsRes, oppsRes] = await Promise.all([
    supabase.from('organizations').select('id, name').eq('workspace_id', me.workspace_id).order('name'),
    supabase
      .from('contacts')
      .select('id, first_name, last_name')
      .eq('workspace_id', me.workspace_id)
      .order('first_name'),
    supabase
      .from('opportunities')
      .select('id, title')
      .eq('workspace_id', me.workspace_id)
      .order('created_at', { ascending: false }),
  ])

  const orgs = (orgsRes.data ?? []) as Pick<Organization, 'id' | 'name'>[]
  const contacts = (contactsRes.data ?? []) as Pick<
    Contact,
    'id' | 'first_name' | 'last_name'
  >[]
  const opps = (oppsRes.data ?? []) as Pick<Opportunity, 'id' | 'title'>[]

  async function create(formData: FormData) {
    'use server'
    const owner = await requireMember()
    const startDate = (formData.get('start_date') as string) || null
    const startTime = (formData.get('start_time') as string) || ''
    const durationMin = parseInt((formData.get('duration') as string) || '0', 10)

    // If a time is given, schedule the task on the calendar (timed event).
    // The calendar columns are only included when actually scheduling, so plain
    // task creation still works if that migration hasn't been applied yet.
    let schedCols: Record<string, unknown> = {}
    if (startDate && startTime) {
      const start = new Date(`${startDate}T${startTime}`)
      const mins = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 30
      schedCols = {
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + mins * 60000).toISOString(),
      }
    }

    const { error } = await supabase
      .from('tasks')
      .insert({
        workspace_id: owner.workspace_id,
        title: formData.get('title') as string,
        description: (formData.get('description') as string) || null,
        start_date: startDate,
        due_date: (formData.get('due_date') as string) || null,
        ...schedCols,
        priority: (formData.get('priority') as string) || 'Medium',
        owner: (formData.get('owner') as string) || null,
        status: (formData.get('status') as string) || 'todo',
        opportunity_id: (formData.get('opportunity_id') as string) || null,
        organization_id: (formData.get('organization_id') as string) || null,
        contact_id: (formData.get('contact_id') as string) || null,
      })
    if (error) throw new Error(error.message)
    revalidatePath('/tasks')
    redirect('/tasks')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-7">
        <Link
          href="/tasks"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-slate-100">New Task</h1>
          <p className="text-xs text-slate-500">Add a task or follow-up</p>
        </div>
      </div>

      <form action={create} className="space-y-5">
        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <div>
            <label className={label}>Title *</label>
            <input
              name="title"
              type="text"
              required
              className={input}
              placeholder="Call the client, send proposal…"
            />
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea
              name="description"
              rows={3}
              className={input + ' resize-none'}
              placeholder="Details…"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Start Date</label>
              <input name="start_date" type="date" className={input} />
            </div>
            <div>
              <label className={label}>End Date</label>
              <input name="due_date" type="date" className={input} />
            </div>
            <div>
              <label className={label}>Start Time</label>
              <input name="start_time" type="time" className={input} />
              <p className="mt-1 text-[10px] text-slate-600">
                Set a time to place it on the calendar
              </p>
            </div>
            <div>
              <label className={label}>Duration</label>
              <select name="duration" defaultValue="30" className={input}>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">1 h</option>
                <option value="90">1 h 30 m</option>
                <option value="120">2 h</option>
                <option value="180">3 h</option>
                <option value="240">4 h</option>
              </select>
            </div>
            <div>
              <label className={label}>Priority</label>
              <select name="priority" defaultValue="Medium" className={input}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Status</label>
              <select name="status" defaultValue="todo" className={input}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className={label}>Owner</label>
              <input
                name="owner"
                type="text"
                className={input}
                placeholder="Responsible person"
              />
            </div>
          </div>
        </section>

        <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Linked Records
          </h2>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className={label}>Opportunity</label>
              <select
                name="opportunity_id"
                defaultValue={sp.opp ?? ''}
                className={input}
              >
                <option value="">— None —</option>
                {opps.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Organization</label>
                <select
                  name="organization_id"
                  defaultValue={sp.org ?? ''}
                  className={input}
                >
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
                <select
                  name="contact_id"
                  defaultValue={sp.contact ?? ''}
                  className={input}
                >
                  <option value="">— None —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {fullName(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <div className="flex gap-3 pt-1">
          <Link
            href="/tasks"
            className="flex-1 text-center py-2.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Create Task
          </button>
        </div>
      </form>
    </div>
  )
}
