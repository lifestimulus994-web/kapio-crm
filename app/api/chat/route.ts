import { NextResponse } from 'next/server'
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai'
import {
  tools,
  runTool,
  buildContext,
  loadKnowledge,
  DESTRUCTIVE_TOOLS,
  type AiScope,
} from '@/lib/crm-ai'
import { parseGeorgianSchedule } from '@/lib/gschedule'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type ChatMessage = { role: 'user' | 'model'; text: string }
type PendingConfirmation = { name: string; args: Record<string, unknown>; description: string }

function describeDestructive(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'archive_organization':
      return `Archive company "${args.organization_name}"?`
    case 'archive_contact':
      return `Archive contact "${args.contact_name}"?`
    case 'archive_opportunity':
      return `Archive deal "${args.opportunity_title}"?`
    case 'archive_task':
      return `Archive task "${args.task_title}"?`
    default:
      return `Confirm ${name}?`
  }
}

// ---------- route ----------
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const scope: AiScope = {
    workspaceId: me.workspace_id,
    memberId: me.id,
    elevated: hasElevatedAccess(me),
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 }
    )
  }

  let body: {
    message?: string
    history?: ChatMessage[]
    confirm?: { name: string; args: Record<string, unknown> }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // A confirmed destructive action from the UI — run it directly, no AI call.
  if (body.confirm) {
    const { name, args } = body.confirm
    if (!DESTRUCTIVE_TOOLS.has(name)) {
      return NextResponse.json({ error: 'Not a confirmable action.' }, { status: 400 })
    }
    const result = await runTool(name, args ?? {}, scope)
    const reply = result.success
      ? `Done.`
      : `Couldn't do that: ${result.error ?? 'unknown error'}`
    return NextResponse.json({ reply, actions: [{ name, result }] })
  }

  const message = (body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }
  const history = (body.history ?? []).slice(-10)

  try {
    // Local date (the server runs in the CRM's timezone) so "today/tomorrow"
    // resolve to the user's calendar, not UTC.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tbilisi',
    }).format(new Date())
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    // Parse any Georgian/relative date+time in the user's message ourselves and
    // give the model an exact start_at to copy — the model is unreliable at this.
    const schedHint = parseGeorgianSchedule(message, today)
    const schedHintText = schedHint
      ? `\n# Parsed schedule for the user's latest message (AUTHORITATIVE)\nThis message specifies a time. If you create or reschedule a task from it, you MUST set start_at="${schedHint.startAt}" and duration_minutes=${schedHint.durationMin} EXACTLY as given here — do not recompute, shift, or add a timezone. Confirm this date/time back to the user.\n`
      : ''

    // Load the business knowledge file and a live snapshot of the CRM data so
    // the assistant can both reason about the company and answer questions
    // about the actual records.
    const [knowledge, crmData] = await Promise.all([
      loadKnowledge(),
      buildContext(scope),
    ])

    const systemInstruction = `You are the AI assistant for Kapio CRM, a sales CRM used by a company in Georgia.
Today's date is ${today}.

${knowledge ? `# Business knowledge\n${knowledge}\n` : ''}
# Live CRM data (current snapshot — ids included for your reference)
${crmData}
${schedHintText}
You can answer questions about the data above AND make changes using the tools.

Guidelines:
- Be concise and direct. Prefer short answers. Reply in the user's language
  (Georgian if they write in Georgian).
- All monetary values are in Georgian Lari (GEL).
- Use the "Live CRM data" snapshot to answer lookups, counts, and lists. If a
  needed field isn't in the snapshot, call get_record rather than guessing or
  saying you don't have it (see FULL RECORD DETAILS below). Only say a record
  doesn't exist at all after checking — never guess an answer you're not sure of.
- To CREATE a record (organization, contact, opportunity, task) call the matching
  create tool. To CHANGE something that already exists — rename or edit a company
  or contact, move a deal to another pipeline stage, mark a task done, change
  priority/owner/due date, or leave a comment — call update_organization,
  update_contact, update_opportunity, update_task, or add_task_comment/
  add_opportunity_comment. Editing an existing record is ALWAYS possible; never
  tell the user you can only create a new one.
- If the user asks to delete/remove/cancel a company, contact, deal, or task, call
  the matching archive_* tool. It will ask the user to confirm before anything
  happens — that confirmation step is handled outside of you, so just call the
  tool normally.
- FULL RECORD DETAILS: the "Live CRM data" snapshot only has index-level fields.
  If a question needs something NOT in the snapshot — an organization's address,
  legal name, or notes; an opportunity's pain_points, next_action, or notes; a
  task's description; or any record's comment/activity history — call get_record
  with the entity type and name/title FIRST, then answer from what it returns.
  Do this instead of saying you don't have the information.
- FIX A WRONG/MISHEARD COMPANY NAME (e.g. from voice input): use
  update_organization with organization_name = the current (wrong) name and
  new_name = the correct one. To also refill its details, FIRST call
  find_company_contacts with the corrected name, then update_organization with
  new_name + the found email/phone/website/address. Do NOT create a duplicate
  company.
- CALENDAR SCHEDULING (IMPORTANT — read carefully): a task shows on the weekly
  calendar ONLY if it has a time. Whenever the user mentions ANY day or clock time,
  you MUST pass start_at on create_task / update_task. NEVER create a task that has
  a stated time but leave start_at empty.
  * Format: a LOCAL ISO datetime WITHOUT any timezone suffix, e.g.
    2026-06-22T16:00:00 (no "Z", no "+04:00"). Also pass duration_minutes
    (default 60 for a meeting, 30 otherwise).
  * Resolve relative DATES against today (${today}):
      Georgian — დღეს = today, ხვალ = tomorrow, ზეგ = the day after tomorrow;
      weekday names (ორშაბათი=Mon, სამშაბათი=Tue, ოთხშაბათი=Wed, ხუთშაბათი=Thu,
      პარასკევი=Fri, შაბათი=Sat, კვირა=Sun) = the next such day.
  * Resolve the TIME. "X საათზე" / "X საათისთვის" = X o'clock. Business-hours rule:
    treat 1–7 as afternoon unless the user says დილის/"morning" — so "ოთხ საათზე" →
    16:00, "ცხრა საათზე" → 09:00, "ექვს საათზე" → 18:00. "ნახევარი X" = (X-1):30.
  * WORKED EXAMPLE: today is ${today}; user says "დანიშნე შეხვედრა ხვალ ოთხ საათზე"
    → call create_task with title:"შეხვედრა", start_at = tomorrow's date at
    16:00:00 (no tz), duration_minutes:60. Then confirm the exact date and time.
  Only when the user gives NO day and NO time at all, create the task without
  start_at (it then sits in "Unscheduled"). To reschedule an existing task, pass
  start_at (+duration_minutes) on update_task.
- MEETINGS & TASKS ARE TASKS, NOT COMPANIES: a request to schedule or log a
  meeting, call, reminder, or to-do (Georgian: შეხვედრა, ზარი, დარეკვა, შეხსენება,
  დავალება, თასქი, follow-up) MUST use create_task — never create_organization,
  even if a company or person is named. Link the named company/person via
  organization_name / contact_name instead.
- SHORT TASK TITLES, CONTEXT GOES IN A COMMENT: when the user describes a task at
  length — background on who's involved, what's being negotiated, why the meeting
  is happening — the task's "title" must stay SHORT and scannable, e.g. "Call with
  Nino Beridze (TBC Bank)" or "შეხვედრა TBC Bank-თან". NEVER put the whole
  sentence in the title. Put any real background in "description" AND, right
  after creating the task, call add_task_comment with a body summarizing that
  context (what's being discussed/negotiated, prior state) — the comment is
  timestamped automatically, so it becomes a dated record of "what this was
  about." If the task is linked to an opportunity (existing or created in the
  same turn), call add_opportunity_comment with the SAME body too, so the
  context is visible from both places. Do this only for real background the user
  gave you — don't invent context that wasn't said.
- To link or target a record, pass its name/title; the system resolves it to an id.
  If it cannot be found, say so plainly.
- AUTO-CONNECT related records, WITHOUT asking for confirmation:
  1. ON CREATE: whenever you create a task or opportunity, read its title/content
     and, if it names a company/contact/opportunity that exists in the snapshot,
     pass that name (organization_name / contact_name / opportunity_title) so the
     new record is linked from the start. E.g. a task "Send proposal to TBC Bank"
     → pass organization_name "TBC Bank".
  2. WHEN WORKING WITH A RECORD: if the user's request touches a record that is
     unlinked but clearly matches an existing one, link it immediately via
     update_task / update_opportunity, and fill obviously-missing fields (owner,
     dates, description) the user provides.
  3. ON REQUEST: if the user asks to "connect / link everything", scan all tasks
     and deals in the snapshot and link every unambiguous match in one go.
- GUARD: only auto-link when the match is UNAMBIGUOUS (a clear name match, or only
  one plausible candidate). If two or more records could match, or you are unsure,
  ask the user which one instead of guessing. Don't overwrite a link that is
  already set unless the user asks. Briefly mention what you connected.
- WEB ENRICHMENT: ONLY when the user EXPLICITLY asks to add/create a company or
  organization (not a meeting, call, or task), FIRST call
  find_company_contacts with the company name (and any city/industry hint). Then
  call create_organization using the results:
    * use "official_name" as the company "name" (it fixes a misheard/misspelled
      name and keeps multi-word names intact — e.g. "ტერავი + პლიუსი" → the real
      "Teravita Plus");
    * fill email, phone, website, and address (location) from the results;
    * fill "identification_code" from the results if present — it comes from
      Georgia's official business registry (companyinfo.ge), so it does NOT
      need a verify warning, unlike the web-sourced fields below.
  In the organization's "notes", append: "⚠️ Email/phone/website/address
  auto-found on the web on ${today} — VERIFY." (omit this note entirely if only
  identification_code was found and nothing else). In your reply, list what was
  auto-filled (including the location and identification code), say the
  contact details are unverified, and show source link(s) if any. If nothing
  reliable was found, create the company with the details the user gave and
  say the lookup found nothing.
- Never search for or store passwords or private credentials — those are not
  publicly available and must never be guessed.
- After a tool runs, briefly confirm what changed. Never claim you changed
  something unless a tool actually succeeded.`

    type GeminiContent = { role: string; parts: Record<string, unknown>[] }

    const contents: GeminiContent[] = [
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: message }] },
    ]

    const config = {
      systemInstruction,
      tools: [{ functionDeclarations: tools }],
    }

    const executed: { name: string; result: Record<string, unknown> }[] = []
    let pending: PendingConfirmation | null = null

    // Keep a single model — never degrade to a weaker one. On a 503/overload,
    // retry the SAME model with exponential backoff. If it is still busy after
    // every attempt, the error bubbles up and the user gets a "busy" message.
    const MODEL = 'gemini-2.5-flash'
    const MAX_ATTEMPTS = 4
    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand/i.test(
        e instanceof Error ? e.message : String(e)
      )

    // When our parser found a concrete date+time, the user clearly wants to
    // schedule a task — force the model to call create_task/update_task (instead
    // of leaving tool choice to chance, where it sometimes did nothing or made a
    // company). The authoritative hint above supplies the exact start_at.
    const forceConfig = {
      ...config,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['create_task', 'update_task'],
        },
      },
    }

    async function generate(reqContents: GeminiContent[], force = false) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          return await ai.models.generateContent({
            model: MODEL,
            contents: reqContents,
            config: force ? forceConfig : config,
          })
        } catch (e) {
          if (!isOverloaded(e) || attempt === MAX_ATTEMPTS - 1) throw e
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        }
      }
      throw new Error('unreachable')
    }

    // Force the task tool only on the first turn when a schedule was parsed.
    let response = await generate(contents, !!schedHint)

    // Resolve any tool calls the model requests (a few rounds at most).
    for (let round = 0; round < 5; round++) {
      const calls = response.functionCalls ?? []
      if (calls.length === 0) break

      const modelContent = response.candidates?.[0]?.content
      if (modelContent) contents.push(modelContent as GeminiContent)

      const responseParts: Record<string, unknown>[] = []
      for (const call of calls) {
        const name = call.name ?? ''
        const args = (call.args ?? {}) as Record<string, unknown>

        if (DESTRUCTIVE_TOOLS.has(name)) {
          // Don't run it — hand it back to the UI for an explicit confirm/cancel,
          // and give the model a synthetic "held for confirmation" response so
          // it can finish the turn with a normal summary instead of retrying.
          pending = { name, args, description: describeDestructive(name, args) }
          responseParts.push({
            functionResponse: {
              name,
              response: { success: true, pending: true, note: 'Held for user confirmation.' },
            },
          })
          continue
        }

        const result = await runTool(name, args, scope)
        executed.push({ name, result })
        responseParts.push({ functionResponse: { name, response: result } })
      }
      contents.push({ role: 'user', parts: responseParts })

      response = await generate(contents)
    }

    let reply = response.text ?? ''
    if (!reply) {
      // Never hand back a dead-end "I didn't understand" — nudge for one more
      // real attempt, and only fall back to something actionable if that also
      // comes back empty.
      const nudge = await generate([
        ...contents,
        {
          role: 'user',
          parts: [
            {
              text: 'You must reply now with something useful: summarize what you found or did, or ask one specific question naming the exact companies/contacts/deals/tasks you are unsure about. Do not say you did not understand.',
            },
          ],
        },
      ])
      reply =
        nudge.text ??
        (executed.length > 0
          ? `Done: ${executed.map((e) => e.name).join(', ')}.`
          : 'Tell me the company, contact, deal, or task name and I’ll look it up.')
    }

    return NextResponse.json({
      reply,
      actions: executed,
      ...(pending ? { pendingConfirmation: pending } : {}),
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Unexpected server error.'
    if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(raw)) {
      return NextResponse.json(
        {
          error:
            'The free-tier AI quota is used up for now. It resets after a while — or enable billing in Google AI Studio for higher limits.',
        },
        { status: 429 }
      )
    }
    if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
      return NextResponse.json(
        {
          error:
            'The AI model is busy right now (high demand). Please try again in a few seconds.',
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: raw }, { status: 500 })
  }
}
