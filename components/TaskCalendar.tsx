'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Briefcase,
  Building2,
  User,
  Loader2,
  ExternalLink,
  CalendarOff,
} from 'lucide-react'
import type { Task, TaskPriority, TaskStatus } from '@/types'
import { TASK_PRIORITIES } from '@/types'
import {
  addDays,
  startOfWeek,
  startOfDay,
  isToday,
  isSameDay,
  ymd,
  fmtTime,
  taskSched,
  eventColor,
  packLanes,
} from '@/lib/calendar'

const HOUR_H = 48 // px per hour
const DAY_MIN = 24 * 60
const GRID_H = HOUR_H * 24
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480]

type OrgOpt = { id: string; name: string }
type ContactOpt = { id: string; first_name: string; last_name: string }
type OppOpt = { id: string; title: string }

type Draft = {
  id?: string
  title: string
  date: string // yyyy-mm-dd
  time: string // HH:mm
  duration: number // minutes
  allDay: boolean
  priority: TaskPriority
  status: TaskStatus
  owner: string
  organization_id: string
  contact_id: string
  opportunity_id: string
}

type Preview = { id: string; dayIndex: number; startMin: number; endMin: number }

const pad = (n: number) => String(n).padStart(2, '0')
const minToHM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const snap = (m: number, step: number) => Math.round(m / step) * step

export default function TaskCalendar({
  tasks,
  orgs,
  contacts,
  opps,
}: {
  tasks: Task[]
  orgs: OrgOpt[]
  contacts: ContactOpt[]
  opps: OppOpt[]
}) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // Optimistic overrides, keyed by task id, applied over the server-provided
  // tasks. A drag/resize/edit shows its result INSTANTLY; without this the
  // event snapped back to its old spot after the ghost cleared and only
  // jumped to the new one seconds later, once router.refresh() delivered
  // fresh props. A failed save rolls its patch back; a successful refresh
  // makes the patch redundant and the effect below drops it.
  const [patches, setPatches] = useState<Record<string, Partial<Task>>>({})

  const contentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ moved: boolean } | null>(null)
  // Latest preview, mirrored from the move handler so the pointerup closure can
  // read it without going through render.
  const previewRef = useRef<Preview | null>(null)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const effectiveTasks = useMemo(
    () => tasks.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)),
    [tasks, patches]
  )

  // Drop a patch once the refreshed server data already carries its values —
  // from then on the server is the source of truth again, so edits made
  // elsewhere (task page, AI agent) aren't pinned under a stale override.
  useEffect(() => {
    const same = (a: unknown, b: unknown) => {
      if (a === b || (a == null && b == null)) return true
      if (typeof a === 'string' && typeof b === 'string') {
        // Timestamps may differ only in serialization (Z vs +00:00).
        const da = Date.parse(a)
        return !Number.isNaN(da) && da === Date.parse(b)
      }
      return false
    }
    setPatches((prev) => {
      const next = { ...prev }
      let changed = false
      for (const t of tasks) {
        const p = next[t.id]
        if (
          p &&
          Object.entries(p).every(([k, v]) => same(t[k as keyof Task], v))
        ) {
          delete next[t.id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [tasks])

  function rollbackPatch(id: string) {
    setPatches((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // Split tasks into all-day and timed, each tagged with its schedule.
  const scheduled = useMemo(
    () =>
      effectiveTasks
        .map((t) => ({ t, s: taskSched(t) }))
        .filter((x): x is { t: Task; s: NonNullable<ReturnType<typeof taskSched>> } => x.s !== null),
    [effectiveTasks]
  )
  const unscheduled = useMemo(
    () => effectiveTasks.filter((t) => taskSched(t) === null),
    [effectiveTasks]
  )

  const weekLabel = `${days[0].toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${days[6].toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`

  // ---- geometry helpers ----
  function pointerMinutes(clientY: number): number {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const mins = ((clientY - rect.top) / HOUR_H) * 60
    return Math.max(0, Math.min(DAY_MIN, mins))
  }
  function pointerDay(clientX: number): number {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const idx = Math.floor(((clientX - rect.left) / rect.width) * 7)
    return Math.max(0, Math.min(6, idx))
  }

  // ---- create on empty slot ----
  function createOnSlot(dayIndex: number, e: React.MouseEvent) {
    if (dragRef.current) return
    const start = snap(pointerMinutes(e.clientY), 30)
    openEditor({
      title: '',
      date: ymd(days[dayIndex]),
      time: minToHM(Math.min(start, DAY_MIN - 30)),
      duration: 30,
      allDay: false,
      priority: 'Medium',
      status: 'todo',
      owner: '',
      organization_id: '',
      contact_id: '',
      opportunity_id: '',
    })
  }

  function openEditorForTask(t: Task) {
    const s = taskSched(t)
    const start = s ? s.start : new Date()
    const durMin = s
      ? Math.max(15, Math.round((s.end.getTime() - s.start.getTime()) / 60000))
      : 30
    openEditor({
      id: t.id,
      title: t.title,
      date: ymd(start),
      time: minToHM(start.getHours() * 60 + start.getMinutes()),
      duration: durMin,
      allDay: s?.allDay ?? false,
      priority: t.priority,
      status: t.status,
      owner: t.owner ?? '',
      organization_id: t.organization_id ?? '',
      contact_id: t.contact_id ?? '',
      opportunity_id: t.opportunity_id ?? '',
    })
  }

  function openEditor(d: Draft) {
    setError(null)
    setDraft(d)
  }

  // ---- drag to move / resize ----
  function beginDrag(
    e: React.PointerEvent,
    task: Task,
    s: NonNullable<ReturnType<typeof taskSched>>,
    mode: 'move' | 'resize'
  ) {
    if (s.allDay) return // all-day events aren't dragged on the time grid
    e.preventDefault()
    e.stopPropagation()
    const startMin0 = s.start.getHours() * 60 + s.start.getMinutes()
    const durMin = Math.max(15, Math.round((s.end.getTime() - s.start.getTime()) / 60000))
    const grabMin = pointerMinutes(e.clientY)
    const offset = grabMin - startMin0
    dragRef.current = { moved: false }

    const move = (ev: PointerEvent) => {
      const m = pointerMinutes(ev.clientY)
      let p: Preview
      if (mode === 'move') {
        const dayIndex = pointerDay(ev.clientX)
        let ns = snap(m - offset, 15)
        ns = Math.max(0, Math.min(DAY_MIN - durMin, ns))
        p = { id: task.id, dayIndex, startMin: ns, endMin: ns + durMin }
      } else {
        const ne = Math.max(startMin0 + 15, Math.min(DAY_MIN, snap(m, 15)))
        const dayIndex = days.findIndex((d) => isSameDay(d, s.start))
        p = { id: task.id, dayIndex, startMin: startMin0, endMin: ne }
      }
      previewRef.current = p
      setPreview(p)
      if (dragRef.current) dragRef.current.moved = true
    }

    const up = async () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const p = previewRef.current
      const moved = dragRef.current?.moved
      dragRef.current = null
      if (!moved || !p) {
        previewRef.current = null
        setPreview(null)
        openEditorForTask(task) // a click, not a drag → edit
        return
      }
      const base = days[p.dayIndex]
      const startAt = new Date(base)
      startAt.setHours(0, 0, 0, 0)
      startAt.setMinutes(p.startMin)
      const endAt = new Date(base)
      endAt.setHours(0, 0, 0, 0)
      endAt.setMinutes(p.endMin)
      const patch = {
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        start_date: ymd(startAt),
        due_date: ymd(endAt),
      }
      // Show the drop result instantly via an optimistic patch; the save runs
      // behind it and only a FAILURE moves the event back (with the error
      // banner explaining why).
      setPatches((prev) => ({ ...prev, [task.id]: patch }))
      previewRef.current = null
      setPreview(null)
      const ok = await save({ id: task.id, ...patch })
      if (!ok) rollbackPatch(task.id)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- persistence ----
  async function save(payload: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not save.')
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Network error. Is the server running?')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveDraft() {
    if (!draft) return
    if (!draft.title.trim()) {
      setError('Title is required.')
      return
    }
    const payload: Record<string, unknown> = {
      id: draft.id,
      title: draft.title.trim(),
      priority: draft.priority,
      status: draft.status,
      owner: draft.owner || null,
      organization_id: draft.organization_id || null,
      contact_id: draft.contact_id || null,
      opportunity_id: draft.opportunity_id || null,
    }
    if (draft.allDay) {
      // All-day → keep dates only, no specific time.
      payload.start_at = null
      payload.end_at = null
      payload.start_date = draft.date
      payload.due_date = draft.date
    } else {
      const start = new Date(`${draft.date}T${draft.time}`)
      const end = new Date(start.getTime() + draft.duration * 60000)
      payload.start_at = start.toISOString()
      payload.end_at = end.toISOString()
      payload.start_date = ymd(start)
      payload.due_date = ymd(end)
    }
    // Editing an existing task: reflect the changes instantly, roll back on a
    // failed save. (A brand-new task has no id to patch — it appears on
    // refresh.)
    if (draft.id) {
      const { id: _ignored, ...fields } = payload
      setPatches((prev) => ({ ...prev, [draft.id!]: fields as Partial<Task> }))
    }
    const ok = await save(payload)
    if (!ok && draft.id) rollbackPatch(draft.id)
    if (ok) setDraft(null)
  }

  async function unschedule() {
    if (!draft?.id) return
    const id = draft.id
    // Remove it from the calendar entirely → back to the Unscheduled list.
    const patch = { start_at: null, end_at: null, start_date: null, due_date: null }
    setPatches((prev) => ({ ...prev, [id]: patch }))
    const ok = await save({ id, ...patch })
    if (!ok) rollbackPatch(id)
    if (ok) setDraft(null)
  }

  // ---------------------------------------------------------------- render
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
          <span className="ml-2 text-sm font-medium text-slate-200">{weekLabel}</span>
        </div>
        <button
          onClick={() =>
            openEditor({
              title: '',
              date: ymd(days.find((d) => isToday(d)) ?? days[0]),
              time: '09:00',
              duration: 30,
              allDay: false,
              priority: 'Medium',
              status: 'todo',
              owner: '',
              organization_id: '',
              contact_id: '',
              opportunity_id: '',
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus size={15} />
          New Task
        </button>
      </div>

      {error && (
        <div className="shrink-0 bg-red-900/30 px-4 py-1.5 text-xs text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* Body: horizontally scrollable on narrow screens so 7 day columns stay tappable */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex h-full min-w-[700px] flex-col">
          {/* Day headers */}
          <div className="flex shrink-0 border-b border-slate-800">
            <div className="w-14 shrink-0" />
            <div className="grid flex-1 grid-cols-7">
              {days.map((d) => (
                <div
                  key={d.toISOString()}
                  className="border-l border-slate-800 px-2 py-1.5 text-center"
                >
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {DAY_NAMES[(d.getDay() + 6) % 7]}
                  </div>
                  <div
                    className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                      isToday(d) ? 'bg-emerald-600 text-white' : 'text-slate-300'
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* All-day row */}
          <div className="flex shrink-0 border-b border-slate-800 bg-slate-900/40">
            <div className="flex w-14 shrink-0 items-center justify-end pr-1.5 text-[10px] text-slate-600">
              all-day
            </div>
            <div className="grid flex-1 grid-cols-7">
              {days.map((d) => {
                const items = scheduled.filter(
                  (x) => x.s.allDay && d >= startOfDay(x.s.start) && d <= startOfDay(x.s.end)
                )
                return (
                  <div
                    key={d.toISOString()}
                    className="min-h-[28px] space-y-0.5 border-l border-slate-800 p-0.5"
                  >
                    {items.map(({ t }) => (
                      <button
                        key={t.id}
                        onClick={() => openEditorForTask(t)}
                        className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${
                          eventColor[t.priority]
                        } ${t.status === 'done' ? 'opacity-50 line-through' : ''}`}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scrollable time grid */}
          <div className="flex flex-1 overflow-y-auto">
            <div className="flex w-full">
              {/* Hour gutter */}
              <div className="relative w-14 shrink-0" style={{ height: GRID_H }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-600"
                    style={{ top: h * HOUR_H }}
                  >
                    {h === 0 ? '' : `${pad(h)}:00`}
                  </div>
                ))}
              </div>

              {/* Day columns + events */}
              <div ref={contentRef} className="relative flex-1" style={{ height: GRID_H }}>
                {/* Hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-slate-800/70"
                    style={{ top: h * HOUR_H }}
                  />
                ))}

                {/* Column hit areas (click to create) */}
                {days.map((d, i) => (
                  <div
                    key={d.toISOString()}
                    onClick={(e) => createOnSlot(i, e)}
                    className={`absolute top-0 bottom-0 border-l border-slate-800 ${
                      isToday(d) ? 'bg-emerald-500/[0.03]' : ''
                    }`}
                    style={{ left: `${(i / 7) * 100}%`, width: `${100 / 7}%` }}
                  />
                ))}

                {/* Timed events, packed into lanes per day */}
                {days.map((d, dayIndex) => {
              const dayItems = scheduled.filter(
                (x) => !x.s.allDay && isSameDay(x.s.start, d)
              )
              const packed = packLanes(
                dayItems.map((x) => ({ ...x, start: x.s.start, end: x.s.end }))
              )
              return packed.map(({ item, lane, lanes }) => {
                const { t, s } = item
                const startMin = s.start.getHours() * 60 + s.start.getMinutes()
                const endMin = Math.min(
                  DAY_MIN,
                  s.end.getHours() * 60 + s.end.getMinutes() || DAY_MIN
                )
                const top = (startMin / 60) * HOUR_H
                const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_H)
                const colW = 100 / 7
                const laneW = colW / lanes
                const left = dayIndex * colW + lane * laneW
                const link =
                  t.opportunity?.title ??
                  t.organization?.name ??
                  (t.contact ? `${t.contact.first_name} ${t.contact.last_name}` : null)
                const LinkIcon = t.opportunity
                  ? Briefcase
                  : t.organization
                    ? Building2
                    : User
                return (
                  <div
                    key={t.id}
                    onPointerDown={(e) => beginDrag(e, t, s, 'move')}
                    className={`group absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] shadow-sm transition-shadow hover:z-30 hover:shadow-md ${
                      eventColor[t.priority]
                    } ${t.status === 'done' ? 'opacity-50' : ''} ${
                      preview?.id === t.id ? 'opacity-30' : ''
                    }`}
                    style={{
                      top,
                      height,
                      left: `${left}%`,
                      width: `calc(${laneW}% - 3px)`,
                      cursor: 'grab',
                    }}
                  >
                    <div
                      className={`truncate font-medium leading-tight ${
                        t.status === 'done' ? 'line-through' : ''
                      }`}
                    >
                      {t.title}
                    </div>
                    <div className="truncate text-[10px] opacity-80">
                      {fmtTime(s.start)}–{fmtTime(s.end)}
                    </div>
                    {link && height > 44 && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] opacity-80">
                        <LinkIcon size={9} className="shrink-0" />
                        <span className="truncate">{link}</span>
                      </div>
                    )}
                    {/* Resize handle */}
                    <div
                      onPointerDown={(e) => beginDrag(e, t, s, 'resize')}
                      className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
                    />
                  </div>
                )
              })
            })}

            {/* Drag preview ghost */}
            {preview && (
              <div
                className="pointer-events-none absolute z-20 rounded-md border-2 border-emerald-400 bg-emerald-500/20"
                style={{
                  top: (preview.startMin / 60) * HOUR_H,
                  height: Math.max(20, ((preview.endMin - preview.startMin) / 60) * HOUR_H),
                  left: `${preview.dayIndex * (100 / 7)}%`,
                  width: `calc(${100 / 7}% - 3px)`,
                }}
              >
                <div className="px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                  {minToHM(preview.startMin)}–{minToHM(preview.endMin)}
                </div>
              </div>
            )}
          </div>
        </div>
          </div>
        </div>
      </div>

      {/* Unscheduled tasks strip */}
      {unscheduled.length > 0 && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/60 px-4 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Unscheduled ({unscheduled.length}) — click to place on the calendar
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.slice(0, 30).map((t) => (
              <button
                key={t.id}
                onClick={() => openEditorForTask(t)}
                className={`max-w-[180px] truncate rounded-full border px-2.5 py-1 text-[11px] ${
                  eventColor[t.priority]
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editor modal */}
      {draft && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !saving && setDraft(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-100">
                {draft.id ? 'Edit task' : 'New task'}
              </p>
              <button
                onClick={() => !saving && setDraft(null)}
                className="text-slate-500 transition-colors hover:text-slate-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3.5 overflow-y-auto px-5 py-4">
              <input
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Task title…"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              />

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })}
                  className="accent-emerald-500"
                />
                All-day
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-[11px] text-slate-500">Date</span>
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  />
                </div>
                {!draft.allDay && (
                  <div>
                    <span className="mb-1 block text-[11px] text-slate-500">Start</span>
                    <input
                      type="time"
                      value={draft.time}
                      onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                    />
                  </div>
                )}
              </div>

              {!draft.allDay && (
                <div>
                  <span className="mb-1 block text-[11px] text-slate-500">Duration</span>
                  <select
                    value={draft.duration}
                    onChange={(e) =>
                      setDraft({ ...draft, duration: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  >
                    {DURATIONS.map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}m` : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-[11px] text-slate-500">Priority</span>
                  <select
                    value={draft.priority}
                    onChange={(e) =>
                      setDraft({ ...draft, priority: e.target.value as TaskPriority })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-slate-500">Status</span>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value as TaskStatus })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[11px] text-slate-500">Owner</span>
                <input
                  value={draft.owner}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                  placeholder="Responsible person"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                />
              </div>

              <div className="space-y-2 border-t border-slate-800 pt-3">
                <select
                  value={draft.opportunity_id}
                  onChange={(e) =>
                    setDraft({ ...draft, opportunity_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                >
                  <option value="">— Opportunity —</option>
                  {opps.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={draft.organization_id}
                    onChange={(e) =>
                      setDraft({ ...draft, organization_id: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  >
                    <option value="">— Organization —</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.contact_id}
                    onChange={(e) => setDraft({ ...draft, contact_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                  >
                    <option value="">— Contact —</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3.5">
              {draft.id && (
                <>
                  <Link
                    href={`/tasks/${draft.id}`}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                  >
                    <ExternalLink size={13} /> Open
                  </Link>
                  <button
                    onClick={unschedule}
                    disabled={saving}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-amber-400 disabled:opacity-40"
                  >
                    <CalendarOff size={13} /> Unschedule
                  </button>
                </>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setDraft(null)}
                  disabled={saving}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDraft}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {draft.id ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
