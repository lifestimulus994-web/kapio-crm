import { GoogleGenAI } from '@google/genai'

// ---------------------------------------------------------------------------
// Customer-facing auto-reply brain. Given the business's knowledge text and a
// conversation transcript, it either answers (in the customer's own language,
// strictly from the knowledge) or hands off to a human — it must never invent
// facts it wasn't told.
// ---------------------------------------------------------------------------

const HANDOFF = '[[HANDOFF]]'

export type AutoReply = { handoff: boolean; text: string }

export async function generateReply(
  knowledge: string,
  transcript: string
): Promise<AutoReply> {
  if (!process.env.GEMINI_API_KEY) return { handoff: true, text: '' }

  const prompt = `You are the customer-facing assistant of a business, replying to inbound Messenger/Instagram messages on the company's behalf. Reply in the SAME language the customer wrote in (most often Georgian). Be concise, warm and natural — like a helpful human rep, not a robot.

Answer ONLY using the company information below. If the customer's question cannot be confidently answered from this information — anything not covered, personal/account-specific, a price not listed, a booking or complaint that needs a real person, or anything you are unsure about — do NOT guess. In that case reply with EXACTLY this token and nothing else: ${HANDOFF}

# Company information
${knowledge?.trim() || '(the business has not provided any information yet)'}

# Conversation so far
${transcript || '(empty)'}

# Your reply now (in the customer's language), or ${HANDOFF} if you cannot answer from the information above:`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    })
    const text = (res.text ?? '').trim()
    if (!text || text.includes(HANDOFF)) return { handoff: true, text: '' }
    return { handoff: false, text }
  } catch {
    // On any AI failure, hand off rather than stay silent.
    return { handoff: true, text: '' }
  }
}
