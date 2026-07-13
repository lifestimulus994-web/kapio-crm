import { NextResponse } from 'next/server'
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai'
import { supabase } from '@/lib/supabase'
import { getCurrentMember, hasElevatedAccess } from '@/lib/auth'
import { buildContext, loadKnowledge, tools, runTool, type AiScope } from '@/lib/crm-ai'
import { checkAiBudget, logAiUsage, budgetExceededMessage } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'

// Mark a task done and record how it actually ended.
//  - mode 'done':   just mark it done.
//  - mode 'manual': mark done + write the outcome as a comment on the linked
//                   opportunity (no AI).
//  - mode 'ai':     mark done + let the agent log a tidy opportunity comment and
//                   create a follow-up task if the outcome implies one.
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const scope: AiScope = {
    workspaceId: me.workspace_id,
    memberId: me.id,
    elevated: hasElevatedAccess(me),
  }

  let body: { taskId?: string; outcome?: string; mode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }

  const taskId = body.taskId
  const outcome = (body.outcome ?? '').trim()
  const mode = body.mode ?? 'done'
  if (!taskId) {
    return NextResponse.json({ error: 'taskId აუცილებელია.' }, { status: 400 })
  }

  // Load the task + its opportunity (needed to attach the comment/follow-up).
  let taskQuery = supabase
    .from('tasks')
    .select('id, title, owner, opportunity:opportunities(id, title)')
    .eq('id', taskId)
    .eq('workspace_id', me.workspace_id)
  if (!scope.elevated) taskQuery = taskQuery.eq('assigned_to', me.id)
  const { data: task, error: taskErr } = await taskQuery.single()
  if (taskErr || !task) {
    return NextResponse.json({ error: 'დავალება ვერ მოიძებნა.' }, { status: 404 })
  }

  // Always mark the task done.
  let updateQuery = supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', taskId)
    .eq('workspace_id', me.workspace_id)
  if (!scope.elevated) updateQuery = updateQuery.eq('assigned_to', me.id)
  const { error: updErr } = await updateQuery
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  const opp = (task.opportunity ?? null) as unknown as {
    id: string
    title: string
  } | null
  const actions: { name: string; result: Record<string, unknown> }[] = []

  // No outcome or no linked deal → nothing more to log.
  if (!outcome || !opp || mode === 'done') {
    return NextResponse.json({ ok: true, summary: 'დავალება მონიშნულია დასრულებულად.', actions })
  }

  // Manual: write the outcome straight onto the opportunity.
  if (mode === 'manual') {
    const { error } = await supabase.from('opportunity_comments').insert({
      opportunity_id: opp.id,
      workspace_id: me.workspace_id,
      author: task.owner || 'You',
      body: outcome,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      ok: true,
      summary: 'შედეგი დაემატა გარიგებას.',
      actions: [{ name: 'add_opportunity_comment', result: { success: true } }],
    })
  }

  // AI: let the agent log a clean comment + create a follow-up if implied.
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY არ არის კონფიგურირებული სერვერზე.' },
      { status: 500 }
    )
  }

  // The task is already marked done above — an exhausted AI budget shouldn't
  // block that, just skip the AI summarization/follow-up step.
  const budget = await checkAiBudget(me.workspace_id, me.workspace_plan)
  if (!budget.allowed) {
    return NextResponse.json({
      ok: true,
      summary: `დავალება დასრულებულია. ${budgetExceededMessage(budget)}`,
      actions,
    })
  }

  let usedInputTokens = 0
  let usedOutputTokens = 0

  try {
    const [context, knowledge] = await Promise.all([
      buildContext(scope),
      loadKnowledge(),
    ])
    const today = new Date().toISOString().slice(0, 10)
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    const systemInstruction = `You are the CRM assistant for Kapio, a sales CRM in Georgia. Today is ${today}.
${knowledge ? `\n# Business knowledge\n${knowledge}\n` : ''}
A salesperson just COMPLETED a task and reported how it actually went. Your job:
1. Call add_opportunity_comment for opportunity "${opp.title}" with a concise, professional
   summary of the real outcome (1–2 sentences, same language as the report).
2. If the outcome implies a follow-up is needed (e.g. the client did not answer, asked to be
   called later, requested a proposal), call create_task to create that follow-up, linked to
   opportunity "${opp.title}", with a sensible due_date (convert "tomorrow"/"in 3 days" to an
   absolute YYYY-MM-DD relative to today). If no follow-up is needed, do not create one.
Do not invent facts beyond the report. LANGUAGE: write EVERYTHING — the comment AND your
final reply — in exactly the same language as the salesperson's report below; if it's in
Georgian, write entirely in Georgian. Reply with one short sentence describing what you logged.

Completed task: "${task.title}"
Salesperson's report: "${outcome}"

Current CRM data (JSON):
${context}`

    type GeminiContent = { role: string; parts: Record<string, unknown>[] }
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'Log the outcome as instructed.' }] },
    ]
    const config = { systemInstruction, tools: [{ functionDeclarations: tools }] }

    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand/i.test(
        e instanceof Error ? e.message : String(e)
      )
    async function generate(reqContents: GeminiContent[], mode: 'ANY' | 'AUTO') {
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
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: reqContents,
            config: cfg,
          })
          usedInputTokens += res.usageMetadata?.promptTokenCount ?? 0
          usedOutputTokens += res.usageMetadata?.candidatesTokenCount ?? 0
          return res
        } catch (e) {
          if (!isOverloaded(e) || attempt === 3) throw e
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        }
      }
      throw new Error('unreachable')
    }

    let response = await generate(contents, 'ANY')
    for (let round = 0; round < 4; round++) {
      const calls = response.functionCalls ?? []
      if (calls.length === 0) break
      const modelContent = response.candidates?.[0]?.content
      if (modelContent) contents.push(modelContent as GeminiContent)
      const responseParts: Record<string, unknown>[] = []
      for (const call of calls) {
        const name = call.name ?? ''
        const args = (call.args ?? {}) as Record<string, unknown>
        const result = await runTool(name, args, scope)
        actions.push({ name, result })
        responseParts.push({ functionResponse: { name, response: result } })
      }
      contents.push({ role: 'user', parts: responseParts })
      response = await generate(contents, 'AUTO')
    }

    const summary = response.text ?? 'შედეგი ჩაიწერა გარიგებაზე.'
    return NextResponse.json({ ok: true, summary, actions })
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'დაფიქსირდა მოულოდნელი შეცდომა სერვერზე.'
    // The task is already done; report the AI failure but don't 500 the whole flow.
    return NextResponse.json(
      { ok: true, summary: `დავალება დასრულებულია, თუმცა AI ჩანაწერმა ვერ იმუშავა: ${raw}`, actions },
      { status: 200 }
    )
  } finally {
    if (usedInputTokens > 0 || usedOutputTokens > 0) {
      await logAiUsage({
        workspaceId: me.workspace_id,
        route: 'task_complete',
        inputTokens: usedInputTokens,
        outputTokens: usedOutputTokens,
      })
    }
  }
}
