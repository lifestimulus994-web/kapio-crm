import { NextResponse } from 'next/server'
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai'
import { buildContext, loadKnowledge, tools, runTool, type AiScope } from '@/lib/crm-ai'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'
import { parseGeorgianSchedule } from '@/lib/gschedule'
import { checkAiBudget, logAiUsage, budgetExceededMessage } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'

// Max inline audio we accept. Gemini inline requests are limited (~20MB total);
// keep some headroom for the CRM context and instructions.
const MAX_BYTES = 15 * 1024 * 1024

// Write tools whose execution we DEFER in "plan" mode: instead of writing to the
// CRM, we collect their arguments as a proposed plan for the user to review/edit
// and then confirm. Read-only enrichment (find_company_contacts) still runs for
// real during planning so the proposed company name/details are already corrected.
const WRITE_TOOLS = new Set([
  'create_organization',
  'create_contact',
  'create_opportunity',
  'create_task',
  'update_organization',
  'update_contact',
  'update_opportunity',
  'update_task',
  'add_task_comment',
  'add_opportunity_comment',
  'add_organization_comment',
  'add_contact_comment',
  'archive_organization',
  'archive_contact',
  'archive_opportunity',
  'archive_task',
])

export async function POST(req: Request) {
  // Two modes share this endpoint:
  //  - JSON body  -> "commit": execute a (user-edited) plan. No AI, no audio.
  //  - multipart  -> "plan":   transcribe + propose a plan, write nothing yet.
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const scope: AiScope = {
    workspaceId: me.workspace_id,
    memberId: me.id,
    elevated: hasElevatedAccess(me),
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return commitPlan(req, scope)
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY არ არის კონფიგურირებული სერვერზე.' },
      { status: 500 }
    )
  }

  const budget = await checkAiBudget(me.workspace_id, me.workspace_plan)
  if (!budget.allowed) {
    return NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 402 })
  }

  // Read the uploaded audio file.
  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json(
      { error: 'ატვირთული ფაილის წაკითხვა ვერ მოხერხდა.' },
      { status: 400 }
    )
  }

  if (!file) {
    return NextResponse.json(
      { error: 'აუდიო ფაილი არ არის მიწოდებული.' },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'აუდიო ფაილი ზედმეტად დიდია (მაქს. 15 MB). გამოიყენე უფრო მოკლე ჩანაწერი.' },
      { status: 413 }
    )
  }

  const mimeType = file.type || 'audio/mpeg'
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  // Usage tracking (hoisted above the try so `finally` can still log
  // whatever was spent even if the request fails partway through): the
  // FIRST Gemini call carries the inline audio (billed at the audio input
  // rate); every later call in the tool-calling loop is text-only (billed
  // at the text rate) — tracked separately for an accurate cost estimate.
  let audioCallDone = false
  let audioInputTokens = 0
  let audioOutputTokens = 0
  let textInputTokens = 0
  let textOutputTokens = 0

  try {
    const [context, knowledge] = await Promise.all([
      buildContext(scope),
      loadKnowledge(),
    ])
    // Local date (the server runs in the CRM's timezone) so "today/tomorrow"
    // resolve to the user's calendar, not UTC — matters most right around
    // midnight, which is exactly when a salesperson tends to dictate a memo.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tbilisi',
    }).format(new Date())
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    const systemInstruction = `You are the data-entry assistant for Kapio CRM, a sales CRM used by a company in Georgia.
You receive a short VOICE MEMO recorded by a salesperson. Today's date is ${today}.
${knowledge ? `\n# Business knowledge\n${knowledge}\n` : ''}

Do the following, in order:
1. Transcribe the audio accurately. It may be in Georgian or English.
2. Figure out what the memo implies: possibly a company (organization), a person
   (contact), a sales deal (opportunity), and/or a follow-up task.
3. IMPORTANT — avoid duplicates: check the existing CRM data below. If a company or
   contact with the same name already EXISTS, do NOT create it again; instead reuse it
   by passing its name to the other tools. Only create what is missing.
   A company name can be several words and the audio may split or mis-hear it
   (e.g. "ტერავიტა პლუს" may come out as "ტერავი" + "პლიუსი"). Treat such a name
   as ONE company — never split it into two organizations.
4. RICH CONVERSATION MEMO (the common case — a salesperson describing a call or
   meeting that actually happened): if the memo describes talking to a real
   person about a real need, problem, or potential deal — not just "schedule a
   meeting" — treat it as full CRM data, not just a reminder. Propose ALL of:
   - create_organization for their company (see lookup rules below), if named
     and not already existing.
   - create_contact for the person, if named and not already existing. No web
     lookup needed for an individual.
   - create_opportunity representing the need/deal discussed — even if nothing
     is confirmed sold yet. A real identified need from a real conversation is
     a pipeline-worthy lead (stage 'New Lead' or 'Contacted', your judgment).
     Set pain_points from what was discussed; set value_gel only if a concrete
     number was mentioned, otherwise leave it out — do not invent a figure.
   - LINK all three to each other (organization_name / contact_name on the
     opportunity).
   - create_task for any concrete follow-up mentioned (next call, next
     meeting), linked to the SAME organization/contact/opportunity by name.
   - add_opportunity_comment (and add_task_comment if a task was created) with
     a DETAILED summary of what was actually discussed — the need, any
     numbers, context, what was agreed — not just "call scheduled." This
     comment is the permanent record of what happened; write it like a real
     CRM note, several sentences if the memo had that much content.
   Only skip organization/contact/opportunity and propose JUST a task when the
   memo is PURELY a scheduling instruction with no conversation content (e.g.
   "move tomorrow's meeting with Nino to 5pm").
   - create_organization lookup: FIRST call find_company_contacts with the
     heard name (add a hint like "Georgia" / the city if known). Use the
     returned "official_name" as the company name (this corrects the misheard
     spelling). REGISTRY data (companyinfo.ge) — trusted, no verify warning:
     fill "legal_name" and "identification_code" from the results. WEB data —
     unverified: fill email, phone, website, and address. In the org "notes"
     add: "⚠️ Email/phone/website/address auto-found on the web — VERIFY." (skip
     this note if only registry data was found). In your summary, explicitly
     list any field the tool's "note" reported as not found — don't silently
     drop it, say plainly it couldn't be found publicly. If the lookup returns
     nothing at all, create it with the name and details from the memo.
   - KEEP TASK TITLES SHORT (e.g. "Call with Nino Beridze (TBC Bank)"), never
     the full memo sentence — background goes in "description" and in the
     comments described above.
5. CALENDAR SCHEDULING: whenever the memo states ANY day or clock time for a
   task/meeting, you MUST pass start_at on create_task/update_task — never
   leave it empty when a time was actually said.
   * Format: LOCAL ISO datetime with NO timezone suffix, e.g.
     2026-06-22T18:00:00 (no "Z", no "+04:00"). Also pass duration_minutes
     (default 60 for a meeting, 30 otherwise).
   * Resolve relative DATES against today (${today}): დღეს = today, ხვალ =
     tomorrow, ზეგ = day after tomorrow; weekday names = the next such day.
   * Resolve the TIME. Business-hours rule: treat 1–7 as afternoon/evening
     UNLESS the memo says დილის/"morning" — so "6 საათზე" (no qualifier, or
     with საღამოს/"evening") → 18:00, "9 საათზე" → 09:00 (morning is the only
     case that stays as-is for 8+; 1–7 always shift to PM by default).
     "ნახევარი X" = (X-1):30.
   * Example: today is ${today}, memo says "ხვალ 6 საათზე საღამოს შევხვდები"
     → start_at = tomorrow's date + "T18:00:00", duration_minutes: 60.
   Only when NO day and NO time are stated at all, create the task without
   start_at (it then sits in "Unscheduled").
6. Do not invent data. Every organization/contact/opportunity/task you propose
   must trace back to something actually said in the memo.

Your tool calls are PROPOSALS — the user will review and confirm them before anything
is saved, so it is fine to propose records. LANGUAGE: your summary/bullet list must be
in exactly the same language as the memo itself — if the memo is in Georgian, write
ENTIRELY in Georgian, no exceptions. Reply with: first the exact transcription, then a
short bullet list of what you propose to add or reuse.

Current CRM data (JSON):
${context}`

    type GeminiContent = { role: string; parts: Record<string, unknown>[] }

    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: 'Here is the voice memo. Process it as instructed.' },
        ],
      },
    ]

    const config = {
      systemInstruction,
      tools: [{ functionDeclarations: tools }],
    }

    const executed: { name: string; result: Record<string, unknown> }[] = []

    // Single model with retry on transient 503 overloads (no quality fallback).
    const MODEL = 'gemini-2.5-flash'
    const MAX_ATTEMPTS = 4
    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand/i.test(
        e instanceof Error ? e.message : String(e)
      )

    // mode 'ANY' forces the model to emit function calls (so it actually writes
    // to the CRM instead of just narrating). After the first forced round we
    // switch to 'AUTO' so it can call more tools or finish with a summary.
    async function generate(
      reqContents: GeminiContent[],
      mode: 'ANY' | 'AUTO'
    ) {
      const cfg = {
        ...config,
        toolConfig: {
          functionCallingConfig: {
            mode:
              mode === 'ANY'
                ? FunctionCallingConfigMode.ANY
                : FunctionCallingConfigMode.AUTO,
          },
        },
      }
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: MODEL,
            contents: reqContents,
            config: cfg,
          })
          if (!audioCallDone) {
            audioInputTokens += res.usageMetadata?.promptTokenCount ?? 0
            audioOutputTokens += res.usageMetadata?.candidatesTokenCount ?? 0
            audioCallDone = true
          } else {
            textInputTokens += res.usageMetadata?.promptTokenCount ?? 0
            textOutputTokens += res.usageMetadata?.candidatesTokenCount ?? 0
          }
          return res
        } catch (e) {
          if (!isOverloaded(e) || attempt === MAX_ATTEMPTS - 1) throw e
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        }
      }
      throw new Error('unreachable')
    }

    // Proposed write actions captured during planning (executed only on commit).
    const plan: { name: string; args: Record<string, unknown> }[] = []

    let response = await generate(contents, 'ANY')

    for (let round = 0; round < 5; round++) {
      const calls = response.functionCalls ?? []
      if (calls.length === 0) break

      const modelContent = response.candidates?.[0]?.content
      if (modelContent) contents.push(modelContent as GeminiContent)

      const responseParts: Record<string, unknown>[] = []
      for (const call of calls) {
        const name = call.name ?? ''
        const args = (call.args ?? {}) as Record<string, unknown>

        if (WRITE_TOOLS.has(name)) {
          // Plan mode: don't write. Record the proposal and hand the model a
          // synthetic success so it keeps planning (e.g. linking by name) and
          // finishes with a summary.
          plan.push({ name, args })
          responseParts.push({
            functionResponse: {
              name,
              response: { success: true, planned: true, preview: args },
            },
          })
        } else {
          // Read-only tools (e.g. find_company_contacts) run for real so the
          // proposed company name/details are already corrected and pre-filled.
          const result = await runTool(name, args, scope)
          executed.push({ name, result })
          responseParts.push({ functionResponse: { name, response: result } })
        }
      }
      contents.push({ role: 'user', parts: responseParts })

      response = await generate(contents, 'AUTO')
    }

    const summary =
      response.text ?? 'ჩანაწერი დამუშავდა, მაგრამ შეჯამება ვერ მომზადდა.'

    // Gemini is unreliable at converting a spoken time expression (e.g. "6
    // საათზე საღამოს") into a correct 24h start_at — same gap the text chat
    // route closes by parsing deterministically instead of trusting the
    // model's own math. Do the same here: parse the transcribed memo (the
    // start of `summary`, per the prompt's reply format) and, if it names a
    // concrete time, force any proposed task's start_at/duration to match —
    // overriding whatever the model guessed.
    const schedHint = parseGeorgianSchedule(summary, today)
    if (schedHint) {
      for (const item of plan) {
        if (item.name === 'create_task' || item.name === 'update_task') {
          item.args.start_at = schedHint.startAt
          item.args.duration_minutes = schedHint.durationMin
        }
      }
    }

    // Return the proposal for the user to review/edit before anything is saved.
    return NextResponse.json({ mode: 'plan', summary, plan })
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
    // Log whatever was actually spent, even on a failed/partial turn.
    if (audioInputTokens > 0 || audioOutputTokens > 0) {
      await logAiUsage({
        workspaceId: me.workspace_id,
        route: 'voice',
        inputTokens: audioInputTokens,
        outputTokens: audioOutputTokens,
        audioInput: true,
      })
    }
    if (textInputTokens > 0 || textOutputTokens > 0) {
      await logAiUsage({
        workspaceId: me.workspace_id,
        route: 'voice',
        inputTokens: textInputTokens,
        outputTokens: textOutputTokens,
      })
    }
  }
}

// Execute a user-reviewed plan. Runs the (possibly edited) write tools in order
// so links-by-name resolve (e.g. the organization is created before the contact
// that references it). No AI call — deterministic and cheap.
async function commitPlan(req: Request, scope: AiScope) {
  let plan: { name: string; args: Record<string, unknown> }[] = []
  try {
    const body = (await req.json()) as {
      plan?: { name: string; args: Record<string, unknown> }[]
    }
    if (Array.isArray(body.plan)) plan = body.plan
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  if (plan.length === 0) {
    return NextResponse.json(
      { error: 'შესანახი არაფერია.' },
      { status: 400 }
    )
  }

  const actions: { name: string; result: Record<string, unknown> }[] = []
  for (const item of plan) {
    if (!WRITE_TOOLS.has(item.name)) continue // ignore anything unexpected
    const result = await runTool(item.name, item.args ?? {}, scope)
    actions.push({ name: item.name, result })
  }

  return NextResponse.json({ mode: 'commit', actions })
}
