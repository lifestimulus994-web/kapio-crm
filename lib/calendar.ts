import type { Task, TaskPriority } from '@/types'

// ---- date helpers (all local-time) ----

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60000)
}

// Monday-based start of the week.
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const day = (x.getDay() + 6) % 7 // Mon=0 … Sun=6
  return addDays(x, -day)
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date())
}

// Local YYYY-MM-DD (for date inputs / comparisons).
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Local YYYY-MM-DDTHH:mm (for datetime-local inputs / query params).
export function ymdhm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${ymd(d)}T${hh}:${mm}`
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// ---- task scheduling ----

export type Sched = { start: Date; end: Date; allDay: boolean }

// A task's effective schedule. A precise start_at means a timed event; a task
// with only start_date/due_date is treated as all-day. (We deliberately don't
// rely on a separate all_day column.) Returns null if the task has no date at
// all (it then shows in the "Unscheduled" list).
export function taskSched(t: Task): Sched | null {
  if (t.start_at) {
    const start = new Date(t.start_at)
    const end = t.end_at ? new Date(t.end_at) : addMinutes(start, 30)
    return { start, end, allDay: false }
  }
  const s = t.start_date ?? t.due_date
  const e = t.due_date ?? t.start_date
  if (s || e) {
    return {
      start: startOfDay(new Date(`${s ?? e}T00:00`)),
      end: startOfDay(new Date(`${e ?? s}T00:00`)),
      allDay: true,
    }
  }
  return null
}

// Solid event colours by priority (for calendar blocks).
export const eventColor: Record<TaskPriority, string> = {
  Low: 'bg-slate-600/80 border-slate-400/50 text-slate-50',
  Medium: 'bg-blue-700/80 border-blue-400/50 text-blue-50',
  High: 'bg-amber-700/80 border-amber-400/50 text-amber-50',
  Urgent: 'bg-red-700/80 border-red-400/50 text-red-50',
}

// Pack overlapping timed events into side-by-side lanes within a single day.
// Returns each task with its lane index and the total lane count to size width.
export function packLanes<T extends { start: Date; end: Date }>(
  items: T[]
): { item: T; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime())
  const laneEnds: number[] = []
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start.getTime())
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end.getTime())
    } else {
      laneEnds[lane] = item.end.getTime()
    }
    return { item, lane }
  })
  const lanes = Math.max(1, laneEnds.length)
  return placed.map((p) => ({ ...p, lanes }))
}
