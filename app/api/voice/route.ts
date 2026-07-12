import { NextResponse } from 'next/server'
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai'
import { buildContext, loadKnowledge, tools, runTool, type AiScope } from '@/lib/crm-ai'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'

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
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 }
    )
  }

  // Read the uploaded audio file.
  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json(
      { error: 'Could not read the uploaded file.' },
      { status: 400 }
    )
  }

  if (!file) {
    return NextResponse.json(
      { error: 'No audio file was provided.' },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Audio file is too large (max 15 MB). Use a shorter clip.' },
      { status: 413 }
    )
  }

  const mimeType = file.type || 'audio/mpeg'
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  try {
    const [context, knowledge] = await Promise.all([
      buildContext(scope),
      loadKnowledge(),
    ])
    const today = new Date().toISOString().slice(0, 10)
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
4. Create the missing records using the tools:
   - create_organization for a new company. FIRST call find_company_contacts with
     the heard name (add a hint like "Georgia" / the city if known). Use the
     returned "official_name" as the company name (this corrects the misheard
     spelling). REGISTRY data (companyinfo.ge) — trusted, no verify warning:
     fill "legal_name" and "identification_code" from the results. WEB data —
     unverified: fill email, phone, website, and address. In the org "notes"
     add: "⚠️ Email/phone/website/address auto-found on the web — VERIFY." (skip
     this note if only registry data was found). If the lookup returns
     nothing, create it with the name and details from the memo.
   - create_contact for a new person (link to the company by name).
   - create_opportunity when the memo describes a potential deal/sale (set value_gel in
     GEL if a number is mentioned, choose a sensible stage, link company/contact by name).
   - create_task when a follow-up or action is mentioned (convert any time reference such
     as "next Friday" or "in two days" into an absolute due_date in YYYY-MM-DD, relative
     to today's date above). Link the task to the company/contact/opportunity it concerns
     by passing their names, so it is connected from the start.
     KEEP THE TITLE SHORT (e.g. "Call with Nino Beridze (TBC Bank)"), never the full
     memo sentence — put any background (what's being discussed, prior context) in
     "description", AND propose an add_task_comment with that same background as the
     body. If the task is linked to an opportunity, also propose add_opportunity_comment
     with the same body, so the context shows up on both records once confirmed.
5. Do not invent data. Only create an opportunity if there is a real deal, and only
   create a task if there is a real follow-up/action.

Your tool calls are PROPOSALS — the user will review and confirm them before anything
is saved, so it is fine to propose records. Reply in the SAME language as the memo with:
first the exact transcription, then a short bullet list of what you propose to add or reuse.

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
          return await ai.models.generateContent({
            model: MODEL,
            contents: reqContents,
            config: cfg,
          })
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
      response.text ?? 'Processed the recording, but produced no summary.'

    // Return the proposal for the user to review/edit before anything is saved.
    return NextResponse.json({ mode: 'plan', summary, plan })
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
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (plan.length === 0) {
    return NextResponse.json(
      { error: 'There is nothing to save.' },
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
