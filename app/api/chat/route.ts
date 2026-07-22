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
import { checkAiBudget, logAiUsage, budgetExceededMessage, tooManyRecent } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'
// A turn can chain several model rounds + tool calls (incl. grounded web
// searches) and ride out 503-overload retries — the platform default (~10s
// on Vercel) cut those off as opaque timeouts.
export const maxDuration = 60

type ChatMessage = { role: 'user' | 'model'; text: string }
type PendingConfirmation = { name: string; args: Record<string, unknown>; description: string }

function describeDestructive(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'archive_organization':
      return `დაარქივდეს კომპანია "${args.organization_name}"?`
    case 'archive_contact':
      return `დაარქივდეს კონტაქტი "${args.contact_name}"?`
    case 'archive_opportunity':
      return `დაარქივდეს გარიგება "${args.opportunity_title}"?`
    case 'archive_task':
      return `დაარქივდეს დავალება "${args.task_title}"?`
    case 'invite_member':
      return `დაპატიჟდეს "${args.email}" გუნდში, როგორც ${args.role === 'manager' ? 'მენეჯერი' : 'წევრი'}?`
    case 'remove_member':
      return `წაიშალოს გუნდის წევრი "${args.member}" და მისი შესვლის მონაცემები?`
    default:
      return `დადასტურდეს ${name}?`
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
    isOwner: me.role === 'owner',
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY არ არის კონფიგურირებული სერვერზე.' },
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
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  // A confirmed destructive action from the UI — run it directly, no AI call.
  if (body.confirm) {
    const { name, args } = body.confirm
    if (!DESTRUCTIVE_TOOLS.has(name)) {
      return NextResponse.json({ error: 'ეს ქმედება არ საჭიროებს დადასტურებას.' }, { status: 400 })
    }
    const result = await runTool(name, args ?? {}, scope)
    const reply = result.success
      ? `შესრულდა.`
      : `ვერ შესრულდა: ${result.error ?? 'უცნობი შეცდომა'}`
    return NextResponse.json({ reply, actions: [{ name, result }] })
  }

  const message = (body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'შეტყობინება აუცილებელია.' }, { status: 400 })
  }
  const history = (body.history ?? []).slice(-10)

  if (await tooManyRecent(me.workspace_id, 'chat', 25)) {
    return NextResponse.json(
      { error: 'ძალიან ბევრი მოთხოვნა მოვიდა. გთხოვთ, ცოტა ხანში სცადეთ.' },
      { status: 429 }
    )
  }

  const budget = await checkAiBudget(me.workspace_id, me.workspace_plan)
  if (!budget.allowed) {
    return NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 402 })
  }

  let usedInputTokens = 0
  let usedOutputTokens = 0

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
- Be concise and direct. Prefer short answers.
- LANGUAGE — ALWAYS MATCH THE USER: reply in exactly the language the user's
  LATEST message is written in, every single time, no exceptions. If they
  write in Georgian, your ENTIRE reply must be in Georgian — not a mix, not
  English with a Georgian phrase, not English because an earlier message in
  this conversation was in English. Re-check the language of every new
  message; users switch, and you must switch with them immediately. Tool
  names, field names, and record data can stay as-is (e.g. company/contact
  names), but every word you write yourself must be in their language.
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
  new_name + the found legal_name/identification_code (trusted, from the
  registry) and email/phone/website/address (unverified, from the web). Do NOT
  create a duplicate company.
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
- MEETINGS & TASKS ARE TASKS, NOT COMPANIES — UNLESS it's a real conversation
  recap: a PURE scheduling instruction with no conversation content ("დანიშნე
  შეხვედრა ხვალ 6-ზე გიორგისთან", "გადაწიე TBC-სთან შეხვედრა 5-ზე") MUST use
  create_task only — never create_organization, even if a company or person is
  named. Link the named company/person via organization_name / contact_name
  instead.
  BUT if the message describes an ACTUAL CONVERSATION that happened — who was
  talked to, their company/role, a need or problem that came up, any numbers
  discussed — treat it as full CRM data, not just a reminder. In that case
  propose/create ALL of: create_organization for their company (web-lookup
  rules below) if named and not already existing; create_contact for the
  person if not already existing; create_opportunity for the need/deal
  discussed — even if nothing is confirmed sold yet, a real identified need
  from a real conversation is a pipeline-worthy lead (stage 'New Lead' or
  'Contacted'); LINK all three to each other; create_task for any concrete
  follow-up mentioned, linked to the same organization/contact/opportunity;
  and a DETAILED add_opportunity_comment (+ add_task_comment) summarizing what
  was actually discussed — the need, numbers, context — not just meeting
  logistics. If the organization/contact/opportunity already exist, don't
  recreate them — just add the comment and/or task, still fully linked.
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
- WEB ENRICHMENT: whenever you are about to create_organization for a NEW
  company — whether the user explicitly asked to add a company, or it came up
  as part of a real-conversation recap (see above) — FIRST call
  find_company_contacts with the company name (and any city/industry hint). Then
  call create_organization using the results:
    * use "official_name" as the company "name" (it fixes a misheard/misspelled
      name and keeps multi-word names intact — e.g. "ტერავი + პლიუსი" → the real
      "Teravita Plus");
    * REGISTRY data (Georgia's official business registry, companyinfo.ge) —
      100% trusted, no verify warning needed: fill "legal_name" from
      legal_name, and "identification_code" from identification_code;
    * WEB data — best-effort, needs the verify warning below: fill email,
      phone, website, and address (location) from the results.
  In the organization's "notes", append: "⚠️ Email/phone/website/address
  auto-found on the web on ${today} — VERIFY." (omit this note entirely if
  only registry data — legal_name/identification_code — was found and no web
  data). In your reply, clearly separate what came from the official registry
  (trusted) vs. the web (unverified), show source link(s) for the web data if
  any, AND explicitly list any field the tool reported as not found (its
  "note" says which ones) — don't silently omit a missing field, say plainly
  it couldn't be found publicly. If nothing reliable was found at all, create
  the company with the details the user gave and say the lookup found nothing.
- LEAD GENERATION (find_leads): when the user asks you to FIND new potential
  clients/companies of some type — e.g. "მომიძებნე 15 ავტოდილერი", "მოძებნე
  უძრავი ქონების სააგენტოები თბილისში", "find hotels in Batumi" — call
  find_leads with a query describing the business type + location, and the
  requested count. This IS one of your core capabilities — NEVER say that
  searching for companies/leads is outside your abilities. Present the results
  as a numbered list (name, phone, email, website, address — omit empty
  fields), clearly flag them as web-sourced and unverified, and cite the
  source links. Then offer to save them as leads; if the user asks to save
  (upfront or after), call create_lead once per company as the tool's "note"
  instructs, skipping companies already in the snapshot.
- LEADS: the snapshot's "leads" array is raw, unqualified funnel entries — separate
  from organizations/contacts/opportunities. Use create_lead/update_lead for a
  new or edited lead. Once a lead is confirmed real and worth pursuing, use
  convert_lead to turn it into an organization/contact/opportunity in one step
  (it also marks the lead 'converted') — don't manually recreate a lead's info
  as a new organization/contact yourself, always convert_lead instead.
- TEAM: the snapshot's "team" array lists every teammate (id, full_name, email,
  role, status) — use it to answer "who's on the team" or resolve assigned_to
  ids to names. Only the OWNER may invite_member, update_member_role, or
  remove_member — if a non-owner asks, say only the owner can do that. An
  invited teammate still needs the Kapio super-admin's separate approval before
  they can log in; say so after inviting.
- WORKSPACE / AI USAGE: the snapshot's "workspace" object has this workspace's
  name/plan/status. Call get_ai_usage when asked about AI cost, spend, or budget.
- STRATEGY BOARDS (brain-map canvases in the სტრატეგია section): call
  list_boards to see what boards exist; get_board to read one's notes and
  arrow connections (use it when asked to explain/summarize a strategy or
  answer "რა წერია დაფაზე"); create_board to turn a plan into a board — pass
  the steps as a tree of SHORT notes (id, text, parent), e.g. a sales script
  where each objection branches to its answer. After creating, tell the user
  to open it in the სტრატეგია section. Boards are workspace-shared.
- JOB POSTINGS (hiring signals): call get_job_postings when asked when a company
  posted a vacancy, what roles a company is hiring for, or similar — it
  searches a daily-synced cache of every vacancy posted on jobs.ge and hr.ge
  (any role, any company). Report the source, company, title, and date
  plainly; if nothing is found, say so instead of guessing.
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
    // Also retries a 429 (per-minute rate limit) the same way — that limit
    // resets every minute, shared across the whole workspace/API key, so a
    // short burst of concurrent users often clears within a couple of
    // retries instead of failing the first request outright.
    const MODEL = 'gemini-2.5-flash'
    // 6 attempts ≈ up to ~15s of backoff — real Gemini 503 spikes routinely
    // outlive the previous 4-attempt/~3.5s window and surfaced as "AI is
    // busy" errors to the user.
    // Keep retries short: a 60s Vercel function must not spend ~31s of backoff
    // on one generate() (6 attempts) and then repeat across tool rounds — that
    // blows the timeout. 3 attempts (0.5+1+2s) still rides out transient
    // overload without risking the whole turn.
    const MAX_ATTEMPTS = 3
    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED|rate.?limit/i.test(
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
          const res = await ai.models.generateContent({
            model: MODEL,
            contents: reqContents,
            config: force ? forceConfig : config,
          })
          usedInputTokens += res.usageMetadata?.promptTokenCount ?? 0
          usedOutputTokens += res.usageMetadata?.candidatesTokenCount ?? 0
          return res
        } catch (e) {
          if (!isOverloaded(e) || attempt === MAX_ATTEMPTS - 1) throw e
          await new Promise((r) => setTimeout(r, Math.min(2000, 500 * 2 ** attempt)))
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
              text: 'You must reply now with something useful, in the same language as the conversation: summarize what you found or did, or ask one specific question naming the exact companies/contacts/deals/tasks you are unsure about. Do not say you did not understand.',
            },
          ],
        },
      ])
      reply =
        nudge.text ??
        (executed.length > 0
          ? `შესრულდა: ${executed.map((e) => e.name).join(', ')}.`
          : 'მითხარი კომპანიის, კონტაქტის, გარიგების ან დავალების სახელი და მოვძებნი.')
    }

    return NextResponse.json({
      reply,
      actions: executed,
      ...(pending ? { pendingConfirmation: pending } : {}),
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'დაფიქსირდა მოულოდნელი შეცდომა სერვერზე.'
    if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(raw)) {
      return NextResponse.json(
        {
          error: 'AI-ის ლიმიტი ამოიწურა. მალე განახლდება — ან ჩართე billing Google AI Studio-ში მეტი ლიმიტისთვის.',
        },
        { status: 429 }
      )
    }
    if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
      return NextResponse.json(
        {
          error: 'AI მოდელი ამჟამად დატვირთულია. სცადე რამდენიმე წამში ხელახლა.',
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: raw }, { status: 500 })
  } finally {
    // Log whatever was actually spent, even on a failed/partial turn — a
    // round that errored out after a few successful generate() calls still
    // cost real tokens.
    if (usedInputTokens > 0 || usedOutputTokens > 0) {
      await logAiUsage({
        workspaceId: me.workspace_id,
        route: 'chat',
        inputTokens: usedInputTokens,
        outputTokens: usedOutputTokens,
      })
    }
  }
}
