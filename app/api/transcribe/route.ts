import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

export const dynamic = 'force-dynamic'

// Lightweight speech-to-text: takes a short audio clip and returns ONLY the
// transcription. Used by the Ask-AI mic button (recorded with MediaRecorder).
// Unlike /api/voice it does not touch the CRM — it just turns speech into text
// that the user can review/edit before sending. Gemini handles Georgian well,
// which the browser's Web Speech API does not.
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 }
    )
  }

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json(
      { error: 'Could not read the uploaded audio.' },
      { status: 400 }
    )
  }

  if (!file) {
    return NextResponse.json(
      { error: 'No audio was provided.' },
      { status: 400 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Audio is too large (max 15 MB).' },
      { status: 413 }
    )
  }

  const mimeType = file.type || 'audio/webm'
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    const isOverloaded = (e: unknown) =>
      /503|UNAVAILABLE|overloaded|high demand/i.test(
        e instanceof Error ? e.message : String(e)
      )

    let response
    for (let attempt = 0; attempt < 4; attempt++) {
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
        break
      } catch (e) {
        if (!isOverloaded(e) || attempt === 3) throw e
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      }
    }

    const text = (response?.text ?? '').trim()
    return NextResponse.json({ text })
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Unexpected server error.'
    if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(raw)) {
      return NextResponse.json(
        { error: 'The AI quota is used up for now. Try again later.' },
        { status: 429 }
      )
    }
    if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
      return NextResponse.json(
        { error: 'The AI model is busy right now. Try again in a few seconds.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: raw }, { status: 500 })
  }
}
