import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import type { Task, TaskStatus } from '@/types'
import { Plus, Calendar, User, Briefcase, CalendarDays, ListTodo } from 'lucide-react'
import { formatDate, isOverdue } from '@/lib/utils'
import { priorityChip, statusMeta, nextStatus } from '@/lib/task-ui'
import StatusToggleButton from '@/components/StatusToggleButton'

export const dynamic = 'force-dynamic'

const groups: TaskStatus[] = ['todo', 'in_progress', 'done']

export default async function TasksPage() {
  const { data, error } = await supabase
    .from('tasks')
    .select(
      '*, organization:organizations(id, name), contact:contacts(id, first_name, last_name), opportunity:opportunities(id, title)'
    )
    .eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load tasks: {error.message}
      </div>
    )
  }

  const tasks = (data ?? []) as Task[]

  async function advanceStatus(formData: FormData) {
    'use server'
    const id = formData.get('id') as string
    const current = formData.get('status') as TaskStatus
    const { error } = await supabase
      .from('tasks')
      .update({ status: nextStatus[current] ?? 'todo' })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath('/tasks')
  }

  const openCount = tasks.filter((t) => t.status !== 'done').length
  const overdueCount = tasks.filter((t) =>
    isOverdue(t.due_date, t.status)
  ).length

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Tasks</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {tasks.length} total · {openCount} open
            {overdueCount > 0 && (
              <span className="text-red-400"> · {overdueCount} overdue</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5 text-xs font-medium">
            <span className="flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-slate-100">
              <ListTodo size={14} /> List
            </span>
            <Link
              href="/tasks/calendar"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-slate-400 transition-colors hover:text-slate-200"
            >
              <CalendarDays size={14} /> Calendar
            </Link>
          </div>
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Task
          </Link>
        </div>
      </div>

      {/* Lists grouped by status */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-7 max-w-4xl">
        {groups.map((status) => {
          const groupTasks = tasks.filter((t) => t.status === status)
          const meta = statusMeta[status]
          return (
            <section key={status}>
              <div className="flex items-center gap-2 mb-3 px-0.5">
                <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  {meta.label}
                </span>
                <span className="text-xs text-slate-500 bg-slate-800 rounded-full px-1.5">
                  {groupTasks.length}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800/70 overflow-hidden">
                {groupTasks.map((task) => {
                  const overdue = isOverdue(task.due_date, task.status)
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Status toggle */}
                      <form action={advanceStatus} className="flex-none">
                        <input type="hidden" name="id" value={task.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={task.status}
                        />
                        <StatusToggleButton status={task.status} />
                      </form>

                      {/* Body (clickable → detail) */}
                      <Link
                        href={`/tasks/${task.id}`}
                        className="flex-1 flex items-center gap-3 min-w-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm leading-snug truncate ${
                              task.status === 'done'
                                ? 'line-through text-slate-600'
                                : 'text-slate-200'
                            }`}
                          >
                            {task.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            {task.opportunity && (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                <Briefcase size={11} />
                                {task.opportunity.title}
                              </span>
                            )}
                            {task.owner && (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                <User size={11} />
                                {task.owner}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Priority */}
                        {task.priority && (
                          <span
                            className={`hidden sm:inline text-[11px] px-2 py-0.5 rounded-full flex-none ${
                              priorityChip[task.priority] ??
                              'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {task.priority}
                          </span>
                        )}

                        {/* Dates */}
                        {(task.start_date || task.due_date) && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs flex-none ${
                              overdue ? 'text-red-400 font-medium' : 'text-slate-500'
                            }`}
                          >
                            <Calendar size={11} />
                            {task.start_date && (
                              <>{formatDate(task.start_date)} → </>
                            )}
                            {task.due_date ? formatDate(task.due_date) : 'No date'}
                          </span>
                        )}
                      </Link>
                    </div>
                  )
                })}

                {groupTasks.length === 0 && (
                  <p className="text-xs text-slate-700 text-center py-6">
                    No tasks here
                  </p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
