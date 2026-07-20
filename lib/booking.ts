import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Deterministic consultation booking. The LLM never invents times — the
// backend computes free slots from working hours minus what's already on the
// calendar (tasks with start_at), and creates the appointment as a task so it
// shows in /tasks/calendar. Georgia is fixed UTC+4 (no DST), so we work in
// "wall-clock" components and stamp a +04:00 offset.
// ---------------------------------------------------------------------------

const TZ_OFFSET = '+04:00'
const OFFSET_MS = 4 * 3600 * 1000
const HORIZON_DAYS = 14

export type BookingConfig = {
  consultMinutes: number
  workDays: Set<number> // 1=Mon .. 7=Sun
  workStart: string // 'HH:MM'
  workEnd: string // 'HH:MM'
  bufferMinutes: number
  minNoticeHours: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const parseHM = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return { h: h || 0, m: m || 0 }
}

// ISO string for a Tbilisi wall-clock time.
function wallIso(y: number, mo: number, d: number, h: number, mi: number) {
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${TZ_OFFSET}`
}

// Next free slots (as ISO strings with +04:00). Reads busy intervals from tasks.
export async function getAvailableSlots(
  workspaceId: string,
  cfg: BookingConfig,
  count = 4
): Promise<string[]> {
  const nowMs = Date.now()
  const minStartMs = nowMs + cfg.minNoticeHours * 3600 * 1000

  // Busy intervals from the calendar (timed tasks) + whole days blocked by
  // all-day tasks.
  const horizonEnd = new Date(nowMs + HORIZON_DAYS * 86400 * 1000).toISOString()
  const { data: tasks } = await supabase
    .from('tasks')
    .select('start_at, end_at, all_day')
    .eq('workspace_id', workspaceId)
    .not('start_at', 'is', null)
    .lte('start_at', horizonEnd)
    .eq('archived', false)

  const busy: { s: number; e: number }[] = []
  const blockedDays = new Set<string>() // 'YYYY-MM-DD' (Tbilisi)
  for (const t of tasks ?? []) {
    if (!t.start_at) continue
    const s = new Date(t.start_at).getTime()
    if (t.all_day) {
      const wall = new Date(s + OFFSET_MS)
      blockedDays.add(
        `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`
      )
    } else {
      const e = t.end_at ? new Date(t.end_at).getTime() : s + cfg.consultMinutes * 60000
      busy.push({ s, e })
    }
  }

  const { h: sh, m: sm } = parseHM(cfg.workStart)
  const { h: eh, m: em } = parseHM(cfg.workEnd)
  const step = cfg.consultMinutes + cfg.bufferMinutes
  const dur = cfg.consultMinutes * 60000

  const slots: string[] = []
  const nowWall = new Date(nowMs + OFFSET_MS) // UTC fields = Tbilisi wall clock

  for (let dayOffset = 0; dayOffset < HORIZON_DAYS && slots.length < count; dayOffset++) {
    const day = new Date(
      Date.UTC(nowWall.getUTCFullYear(), nowWall.getUTCMonth(), nowWall.getUTCDate() + dayOffset)
    )
    const dow = day.getUTCDay() // 0=Sun..6=Sat
    const weekday = dow === 0 ? 7 : dow
    if (!cfg.workDays.has(weekday)) continue
    const y = day.getUTCFullYear()
    const mo = day.getUTCMonth() + 1
    const d = day.getUTCDate()
    if (blockedDays.has(`${y}-${pad(mo)}-${pad(d)}`)) continue

    const dayStartMin = sh * 60 + sm
    const dayEndMin = eh * 60 + em
    for (let t = dayStartMin; t + cfg.consultMinutes <= dayEndMin && slots.length < count; t += step) {
      const h = Math.floor(t / 60)
      const mi = t % 60
      const iso = wallIso(y, mo, d, h, mi)
      const startMs = new Date(iso).getTime()
      if (startMs < minStartMs) continue
      const endMs = startMs + dur
      const clash = busy.some((b) => startMs < b.e && endMs > b.s)
      if (clash) continue
      slots.push(iso)
    }
  }
  return slots
}

// Re-validate a specific slot right before booking (someone may have taken it).
export async function isSlotFree(
  workspaceId: string,
  slotIso: string,
  minutes: number
): Promise<boolean> {
  const startMs = new Date(slotIso).getTime()
  const endMs = startMs + minutes * 60000
  const winStart = new Date(startMs - 6 * 3600 * 1000).toISOString()
  const winEnd = new Date(endMs + 6 * 3600 * 1000).toISOString()
  const { data: tasks } = await supabase
    .from('tasks')
    .select('start_at, end_at, all_day')
    .eq('workspace_id', workspaceId)
    .eq('archived', false)
    .not('start_at', 'is', null)
    .gte('start_at', winStart)
    .lte('start_at', winEnd)
  for (const t of tasks ?? []) {
    if (!t.start_at) continue
    const s = new Date(t.start_at).getTime()
    if (t.all_day) {
      const wall = new Date(s + OFFSET_MS)
      const slotWall = new Date(startMs + OFFSET_MS)
      if (
        wall.getUTCFullYear() === slotWall.getUTCFullYear() &&
        wall.getUTCMonth() === slotWall.getUTCMonth() &&
        wall.getUTCDate() === slotWall.getUTCDate()
      )
        return false
    } else {
      const e = t.end_at ? new Date(t.end_at).getTime() : s + minutes * 60000
      if (startMs < e && endMs > s) return false
    }
  }
  return true
}

const WEEKDAYS_KA = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი']
const MONTHS_KA = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']

// Human Georgian label for a slot ISO, e.g. "სამშაბათი, 22 ივლ, 14:00".
export function slotLabel(iso: string): string {
  const wall = new Date(new Date(iso).getTime() + OFFSET_MS)
  const wd = WEEKDAYS_KA[wall.getUTCDay()]
  const day = wall.getUTCDate()
  const mon = MONTHS_KA[wall.getUTCMonth()]
  const hh = pad(wall.getUTCHours())
  const mm = pad(wall.getUTCMinutes())
  return `${wd}, ${day} ${mon}, ${hh}:${mm}`
}

// Numbered Georgian offer message for a set of slots.
export function slotsOfferMessage(slots: string[]): string {
  const lines = slots.map((s, i) => `${i + 1}. ${slotLabel(s)}`)
  return `თავისუფალია შემდეგი დროები (თბილისის დროით):\n${lines.join('\n')}\n\nრომელი გერჩივნათ? დაწერეთ ნომერი ან დრო.`
}

// Create the appointment as a calendar task. Idempotent: caller passes the
// conversation's existing booking_task_id to avoid duplicates.
export async function createBooking(opts: {
  workspaceId: string
  assignedTo: string | null
  name: string
  phone: string | null
  slotIso: string
  consultMinutes: number
  source: string
}): Promise<string | null> {
  const startMs = new Date(opts.slotIso).getTime()
  const endIso = new Date(startMs + opts.consultMinutes * 60000).toISOString()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      workspace_id: opts.workspaceId,
      assigned_to: opts.assignedTo,
      title: `კონსულტაცია — ${opts.name}`,
      description: `Messenger-იდან დაჯავშნილი კონსულტაცია.\nსახელი: ${opts.name}${opts.phone ? `\nტელეფონი: ${opts.phone}` : ''}\nწყარო: ${opts.source}`,
      start_at: opts.slotIso,
      end_at: endIso,
      all_day: false,
      priority: 'High',
      status: 'todo',
    })
    .select('id')
    .single()
  if (error) {
    console.error('[booking] create failed', error)
    return null
  }
  return data.id as string
}
