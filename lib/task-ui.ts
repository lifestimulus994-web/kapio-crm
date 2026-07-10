import type { TaskPriority, TaskStatus } from '@/types'

// Tailwind classes for a priority chip.
export const priorityChip: Record<TaskPriority, string> = {
  Low: 'bg-slate-700/70 text-slate-300',
  Medium: 'bg-blue-900/50 text-blue-300',
  High: 'bg-amber-900/50 text-amber-300',
  Urgent: 'bg-red-900/50 text-red-300',
}

// Small coloured dot + label per status.
export const statusMeta: Record<TaskStatus, { label: string; dot: string }> = {
  todo: { label: 'To Do', dot: 'bg-slate-500' },
  in_progress: { label: 'In Progress', dot: 'bg-amber-500' },
  done: { label: 'Done', dot: 'bg-emerald-500' },
}

// Cycle a task through todo -> in_progress -> done -> todo.
export const nextStatus: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
}
