import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Task, Organization, Contact, Opportunity } from '@/types'
import { CalendarDays, ListTodo, Plus } from 'lucide-react'
import TaskCalendar from '@/components/TaskCalendar'

export const dynamic = 'force-dynamic'

export default async function TasksCalendarPage() {
  const [tasksRes, orgsRes, contactsRes, oppsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        '*, organization:organizations(id, name), contact:contacts(id, first_name, last_name), opportunity:opportunities(id, title)'
      ),
    supabase.from('organizations').select('id, name').order('name'),
    supabase
      .from('contacts')
      .select('id, first_name, last_name')
      .order('first_name'),
    supabase
      .from('opportunities')
      .select('id, title')
      .order('created_at', { ascending: false }),
  ])

  if (tasksRes.error) {
    return (
      <div className="p-8 text-sm text-red-400">
        Failed to load tasks: {tasksRes.error.message}
        <p className="mt-2 text-xs text-slate-500">
          If this mentions a missing column (start_at / end_at), run the calendar
          migration in schema.sql against your Supabase database.
        </p>
      </div>
    )
  }

  const tasks = (tasksRes.data ?? []) as Task[]
  const orgs = (orgsRes.data ?? []) as Pick<Organization, 'id' | 'name'>[]
  const contacts = (contactsRes.data ?? []) as Pick<
    Contact,
    'id' | 'first_name' | 'last_name'
  >[]
  const opps = (oppsRes.data ?? []) as Pick<Opportunity, 'id' | 'title'>[]

  return (
    <div className="flex h-full flex-col">
      {/* Header with view toggle */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Tasks</h1>
          <p className="mt-0.5 text-xs text-slate-500">Weekly calendar</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5 text-xs font-medium">
            <Link
              href="/tasks"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-slate-400 transition-colors hover:text-slate-200"
            >
              <ListTodo size={14} /> List
            </Link>
            <span className="flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-slate-100">
              <CalendarDays size={14} /> Calendar
            </span>
          </div>
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus size={16} />
            New Task
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <TaskCalendar tasks={tasks} orgs={orgs} contacts={contacts} opps={opps} />
      </div>
    </div>
  )
}
