import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { getCurrentMember } from '@/lib/auth'
import { checkAiBudget, logAiUsage, budgetExceededMessage } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'
// Audio transcription + 503-retry backoff won't fit the platform default
// (~10s on Vercel) — that cut off as an opaque timeout.
export const maxDuration = 60

// Lightweight speech-to-text: takes a short audio clip and returns ONLY the
// transcription. Used by the Ask-AI mic button (recorded with MediaRecorder).
// Unlike /api/voice it does not touch the CRM — it just turns speech into text
// that the user can review/edit before sending. Gemini handles Georgian well,
// which the browser's Web Speech API does not.
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

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

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json(
      { error: 'ატვირთული აუდიოს წაკითხვა ვერ მოხერხდა.' },
      { status: 400 }
    )
  }

  if (!file) {
    return NextResponse.json(
      { error: 'აუდიო არ არის მიწოდებული.' },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'აუდიო ზედმეტად დიდია (მაქს. 15 MB).' },
      { status: 413 }
    )
  }

  const mimeType = file.type || 'audio/webm'
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  let usedInputTokens = 0
  let usedOutputTokens = 0

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    // Retries transient 503 overloads and 429 per-minute rate-limit hits —
    // that limit resets every minute, so a short burst of concurrent users
    // often clears within a couple of retries.
    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED|rate.?limit/i.test(
        e instanceof Error ? e.message : String(e)
      )

    let response
    // 6 attempts ≈ up to ~15s of backoff — real 503 spikes outlive 4/~3.5s.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data: base64 } },
                {
                  text: 'Transcribe this audio exactly. It may be in Georgian or English. Output ONLY the transcription text — no quotes, no labels, no extra commentary.',
                },
              ],
            },
          ],
        })
        usedInputTokens += response.usageMetadata?.promptTokenCount ?? 0
        usedOutputTokens += response.usageMetadata?.candidatesTokenCount ?? 0
        break
      } catch (e) {
        if (!isOverloaded(e) || attempt === 5) throw e
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      }
    }

    const text = (response?.text ?? '').trim()
    return NextResponse.json({ text })
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'დაფიქსირდა მოულოდნელი შეცდომა სერვერზე.'
    if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(raw)) {
      return NextResponse.json(
        { error: 'AI-ის ლიმიტი ამჟამად ამოწურულია. სცადე მოგვიანებით.' },
        { status: 429 }
      )
    }
    if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
      return NextResponse.json(
        { error: 'AI მოდელი ამჟამად დატვირთულია. სცადე რამდენიმე წამში ხელახლა.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: raw }, { status: 500 })
  } finally {
    if (usedInputTokens > 0 || usedOutputTokens > 0) {
      await logAiUsage({
        workspaceId: me.workspace_id,
        route: 'transcribe',
        inputTokens: usedInputTokens,
        outputTokens: usedOutputTokens,
        audioInput: true,
      })
    }
  }
}
