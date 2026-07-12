import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { requireMember, hasElevatedAccess } from '@/lib/auth'
import type { Task, TaskComment, TaskStatus } from '@/types'
import {
  ChevronLeft,
  Pencil,
  AlertTriangle,
  Calendar,
  Flag,
  User,
  Users,
  Briefcase,
  Building2,
  Check,
} from 'lucide-react'
import { formatDate, isOverdue, fullName } from '@/lib/utils'
import { priorityChip, statusMeta, nextStatus } from '@/lib/task-ui'
import CommentThread from '@/components/CommentThread'

export const dynamic = 'force-dynamic'

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await requireMember()
  const elevated = hasElevatedAccess(me)

  let taskQuery = supabase
    .from('tasks')
    .select(
      '*, organization:organizations(id, name), contact:contacts(id, first_name, last_name), opportunity:opportunities(id, title), assignee:members(id, full_name, email)'
    )
    .eq('id', id)
    .eq('workspace_id', me.workspace_id)
  if (!elevated) taskQuery = taskQuery.eq('assigned_to', me.id)

  const [taskRes, commentsRes, membersRes] = await Promise.all([
    taskQuery.single(),
    supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', id)
      .eq('workspace_id', me.workspace_id)
      .order('created_at', { ascending: true }),
    elevated
      ? supabase
          .from('members')
          .select('id, full_name, email')
          .eq('workspace_id', me.workspace_id)
          .order('full_name')
      : Promise.resolve({ data: null, error: null }),
  ])

  if (taskRes.error || !taskRes.data) {
    return <div className="p-8 text-red-400 text-sm">Task not found</div>
  }

  const task = taskRes.data as Task
  // If the comments table isn't migrated yet, degrade gracefully.
  const comments = (commentsRes.error ? [] : commentsRes.data ?? []) as TaskComment[]
  const commentsReady = !commentsRes.error
  const overdue = isOverdue(task.due_date, task.status)
  const members = (membersRes.data ?? []) as { id: string; full_name: string | null; email: string }[]

  async function advanceStatus() {
    'use server'
    const owner = await requireMember()
    const { error } = await supabase
      .from('tasks')
      .update({ status: nextStatus[task.status] ?? 'todo' })
      .eq('id', id)
      .eq('workspace_id', owner.workspace_id)
    if (error) throw new Error(error.message)
    revalidatePath(`/tasks/${id}`)
    revalidatePath('/tasks')
  }

  async function addComment(formData: FormData) {
    'use server'
    const owner = await requireMember()
    const body = (formData.get('body') as string)?.trim()
    if (!body) return
    const author =
      (formData.get('author') as string)?.trim() || task.owner || 'You'
    const { error } = await supabase
      .from('task_comments')
      .insert({ task_id: id, workspace_id: owner.workspace_id, author, body })
    if (error) throw new Error(error.message)
    revalidatePath(`/tasks/${id}`)
  }

  async function assign(formData: FormData) {
    'use server'
    const current = await requireMember()
    if (!hasElevatedAccess(current)) return
    const newAssignee = (formData.get('assigned_to') as string) || null

    const { data: before } = await supabase
      .from('tasks')
      .select('assigned_to, assignee:members(full_name, email)')
      .eq('id', id)
      .eq('workspace_id', current.workspace_id)
      .single()

    const { error } = await supabase
      .from('tasks')
      .update({ assigned_to: newAssignee })
      .eq('id', id)
      .eq('workspace_id', current.workspace_id)
    if (error) throw new Error(error.message)

    if (before && before.assigned_to !== newAssignee) {
      const prev = before.assignee as unknown as { full_name: string | null; email: string } | null
      const { data: next } = newAssignee
        ? await supabase.from('members').select('full_name, email').eq('id', newAssignee).single()
        : { data: null }
      const prevName = prev ? prev.full_name || prev.email : 'Unassigned'
      const nextName = next ? next.full_name || next.email : 'Unassigned'
      await supabase.from('task_comments').insert({
        task_id: id,
        workspace_id: current.workspace_id,
        author: current.full_name || current.email,
        body: `Reassigned from ${prevName} to ${nextName}`,
      })
    }

    revalidatePath(`/tasks/${id}`)
    revalidatePath('/tasks')
  }

  const meta = statusMeta[task.status]

  const info: { Icon: typeof Calendar; label: string; value: string; href?: string; danger?: boolean }[] =
    [
      {
        Icon: Calendar,
        label: 'Start Date',
        value: task.start_date ? formatDate(task.start_date) : '—',
      },
      {
        Icon: Calendar,
        label: 'End Date',
        value: task.due_date ? formatDate(task.due_date) : '—',
        danger: overdue,
      },
      { Icon: Flag, label: 'Priority', value: task.priority ?? 'Medium' },
      { Icon: User, label: 'Owner', value: task.owner || '—' },
      {
        Icon: Briefcase,
        label: 'Opportunity',
        value: task.opportunity?.title ?? '—',
        href: task.opportunity ? `/` : undefined,
      },
      {
        Icon: Building2,
        label: 'Organization',
        value: task.organization?.name ?? '—',
        href: task.organization
          ? `/organizations/${task.organization.id}`
          : undefined,
      },
    ]

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link
          href="/tasks"
          className="mt-1 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1
            className={`text-xl font-semibold ${
              task.status === 'done'
                ? 'text-slate-500 line-through'
                : 'text-slate-100'
            }`}
          >
            {task.title}
          </h1>
          {task.opportunity && (
            <p className="text-xs text-emerald-500 mt-1 inline-flex items-center gap-1">
              <Briefcase size={12} />
              {task.opportunity.title}
            </p>
          )}
        </div>
        <Link
          href={`/tasks/${id}/edit`}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-none"
        >
          <Pencil size={14} />
          Edit
        </Link>
      </div>

      {/* Overdue banner */}
      {overdue && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-900/60 bg-red-900/20 px-4 py-2.5 text-sm text-red-300">
          <AlertTriangle size={16} />
          Task is overdue — end date was {formatDate(task.due_date)}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Status control */}
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200`}
            >
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <form action={advanceStatus}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/40 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Check size={13} />
                {task.status === 'done'
                  ? 'Reopen'
                  : task.status === 'in_progress'
                    ? 'Mark done'
                    : 'Start'}
              </button>
            </form>
          </div>

          {/* Description */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-2">Description</p>
            {task.description ? (
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            ) : (
              <p className="text-sm text-slate-600">No description.</p>
            )}
          </div>

          {/* Comments */}
          <CommentThread
            comments={comments}
            commentsReady={commentsReady}
            addComment={addComment}
            defaultAuthor={task.owner ?? ''}
          />
        </div>

        {/* Right info panel */}
        <div className="space-y-2.5">
          {info.map(({ Icon, label, value, href, danger }) => {
            const isPriority = label === 'Priority'
            return (
              <div
                key={label}
                className="flex items-center justify-between gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl px-3.5 py-3"
              >
                <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <Icon size={13} />
                  {label}
                </span>
                {isPriority && task.priority ? (
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      priorityChip[task.priority] ?? 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {task.priority}
                  </span>
                ) : href ? (
                  <Link
                    href={href}
                    className="text-sm text-slate-200 hover:text-emerald-400 truncate max-w-[160px] transition-colors"
                  >
                    {value}
                  </Link>
                ) : (
                  <span
                    className={`text-sm truncate max-w-[160px] ${
                      danger ? 'text-red-400 font-medium' : 'text-slate-200'
                    }`}
                  >
                    {value}
                  </span>
                )}
              </div>
            )
          })}

          {task.contact && (
            <div className="flex items-center justify-between gap-3 bg-slate-800/40 border border-slate-700/60 rounded-xl px-3.5 py-3">
              <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                <User size={13} />
                Contact
              </span>
              <Link
                href={`/contacts/${task.contact.id}`}
                className="text-sm text-slate-200 hover:text-emerald-400 truncate max-w-[160px] transition-colors"
              >
                {fullName(task.contact)}
              </Link>
            </div>
          )}

          {/* Assignment (owner/manager only) */}
          {elevated && (
            <form
              action={assign}
              className="bg-slate-800/40 border border-slate-700/60 rounded-xl px-3.5 py-3"
            >
              <span className="inline-flex items-center gap-2 mb-1.5 text-xs text-slate-500">
                <Users size={13} />
                Assigned to
              </span>
              <div className="flex gap-2">
                <select
                  name="assigned_to"
                  defaultValue={task.assigned_to ?? ''}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                >
                  <option value="">— Unassigned —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex-none"
                >
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
