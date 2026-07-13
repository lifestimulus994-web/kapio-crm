// Deterministic Georgian/relative date+time parser for the AI assistant.
// gemini-2.5-flash is unreliable at turning "ხვალ ოთხ საათზე" into an exact
// timestamp, so we parse it ourselves and hand the model a ready start_at to
// copy. Returns a LOCAL ISO datetime (no timezone) + duration, or null.

const HOUR_WORDS: Record<string, number> = {
  ერთ: 1,
  ორ: 2,
  სამ: 3,
  ოთხ: 4,
  ხუთ: 5,
  ექვს: 6,
  შვიდ: 7,
  რვა: 8,
  ცხრა: 9,
  ათ: 10,
  თერთმეტ: 11,
  თორმეტ: 12,
}

// Weekday stems → JS getDay() (0=Sun … 6=Sat). Check these BEFORE hour words
// because e.g. "ოთხშაბათ" (Wed) starts with "ოთხ" (four).
const WEEKDAYS: { stem: string; dow: number }[] = [
  { stem: 'ორშაბათ', dow: 1 },
  { stem: 'სამშაბათ', dow: 2 },
  { stem: 'ოთხშაბათ', dow: 3 },
  { stem: 'ხუთშაბათ', dow: 4 },
  { stem: 'პარასკევ', dow: 5 },
  { stem: 'შაბათ', dow: 6 },
  { stem: 'კვირა', dow: 0 },
]

const pad = (n: number) => String(n).padStart(2, '0')

export type ScheduleHint = { startAt: string; durationMin: number }

// `today` is a local YYYY-MM-DD string (the date shown to the model).
export function parseGeorgianSchedule(
  message: string,
  today: string
): ScheduleHint | null {
  const text = ` ${message.toLowerCase()} `

  // ---- find the day ----
  const base = new Date(`${today}T00:00:00`)
  let dayOffset: number | null = null

  if (/მაზეგ/.test(text)) dayOffset = 3
  else if (/ზეგ/.test(text)) dayOffset = 2
  else if (/ხვალ/.test(text)) dayOffset = 1
  else if (/დღეს/.test(text)) dayOffset = 0

  let weekdayTarget: number | null = null
  if (dayOffset === null) {
    for (const w of WEEKDAYS) {
      if (text.includes(w.stem)) {
        weekdayTarget = w.dow
        break
      }
    }
  }

  // ---- find the time ----
  let hour: number | null = null
  let minute = 0

  // 1) explicit HH:MM (16:00, 9:30) or "16 საათ"
  const hm = text.match(/(\d{1,2})[:.](\d{2})/)
  const hOnly = text.match(/(\d{1,2})\s*საათ/)
  if (hm) {
    hour = parseInt(hm[1], 10)
    minute = parseInt(hm[2], 10)
  } else if (hOnly) {
    hour = parseInt(hOnly[1], 10)
  } else {
    // 2) a Georgian number-word near "საათ"
    for (const [stem, h] of Object.entries(HOUR_WORDS)) {
      // word boundary-ish: stem followed by a Georgian case ending then საათ
      const re = new RegExp(`${stem}[ა-ჰ]{0,3}\\s+საათ`)
      if (re.test(text)) {
        hour = h
        break
      }
    }
  }

  // 3) bare "N-ზე" / "Nზე" (colloquial "at N", no "საათ" word at all — e.g.
  // "18-ზე ჩანიშნე" or "6-ზე შევხვდეთ"). Only when nothing more explicit
  // matched, and only within a valid hour range so it doesn't fire on an
  // unrelated number (a price, a quantity) that happens to precede "-ზე".
  // 4) bare "N-ზე" / "Nზე" (colloquial "at N", no "საათ" word at all — e.g.
  // "18-ზე ჩანიშნე"). This is genuinely ambiguous in Georgian — "5-ზე
  // შევთანხმდით" means "agreed on 5 [GEL]", not "at 5 o'clock" — so only
  // attempt it when the message also has an unmistakable scheduling verb/
  // noun nearby; without that guard this used to misfire on prices/amounts.
  const SCHEDULING_CONTEXT =
    /შეხვედრ|ჩანიშნ|ჩამინიშნ|დაჯავშნ|ვხვდებ|შევხვდ|დარეკ|ზარი|თასქ|დავალებ|გადავდო|გადავწი/
  if (hour === null && SCHEDULING_CONTEXT.test(text)) {
    // No \b here: Georgian letters aren't "word" characters to JS regex, so
    // \b never matches after ზე and silently fails the whole pattern. The
    // negative lookbehind instead makes sure we capture a digit run from its
    // true start (so "500-ზე" isn't misread as hour "00" from its tail).
    const bare = text.match(/(?<!\d)(\d{1,2})\s*-?\s*ზე(?![ა-ჰ])/)
    if (bare) {
      const h = parseInt(bare[1], 10)
      if (h >= 0 && h <= 23) hour = h
    }
  }

  // "ნახევარი" → :30 (e.g. "ხუთის ნახევარი" = 4:30) — but NOT "ნახევარი საათი",
  // which is a half-hour DURATION, handled below.
  if (
    /ნახევარ/.test(text) &&
    minute === 0 &&
    !/ნახევარ[ა-ჰ]*\s*საათ/.test(text)
  )
    minute = 30

  if (hour === null) return null // no time → not a calendar event

  // ---- AM/PM for ambiguous 1–7 (business hours default to afternoon) ----
  const morning = /დილ/.test(text)
  const evening = /საღამო|შუადღ|ღამ/.test(text)
  if (hour >= 1 && hour <= 7 && !morning) hour += 12
  else if (evening && hour < 12) hour += 12
  if (hour === 24) hour = 12
  if (hour > 23) hour = hour % 24

  // ---- duration ----
  let durationMin = 60
  const durMin = text.match(/(\d+)\s*წუთ/)
  const durHr = text.match(/(\d+)\s*საათ(?:ი|ის)?\s*(?:ხანგრძ|გრძელ|განმავ)/)
  if (durMin) durationMin = parseInt(durMin[1], 10)
  else if (durHr) durationMin = parseInt(durHr[1], 10) * 60
  else if (/ნახევარი?\s*საათ/.test(text)) durationMin = 30

  // ---- compute the date ----
  const d = new Date(base)
  if (dayOffset !== null) {
    d.setDate(d.getDate() + dayOffset)
  } else if (weekdayTarget !== null) {
    const cur = d.getDay()
    let diff = (weekdayTarget - cur + 7) % 7
    if (diff === 0) diff = 7 // "on Monday" = next Monday, not today
    d.setDate(d.getDate() + diff)
  }
  // else: no day mentioned → keep today's date

  const startAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(hour)}:${pad(minute)}:00`

  return { startAt, durationMin }
}
