import { GoogleGenAI } from '@google/genai'

// ---------------------------------------------------------------------------
// Customer-facing auto-reply brain. Given the business's knowledge text and a
// conversation transcript, it either answers (in the customer's own language,
// strictly from the knowledge) or hands off to a human — it must never invent
// facts, and must never fall back to a generic greeting when it actually
// cannot answer the question.
// ---------------------------------------------------------------------------

const HANDOFF = '[[HANDOFF]]'

export type AutoReply = { handoff: boolean; text: string }

export async function generateReply(
  knowledge: string,
  transcript: string
): Promise<AutoReply> {
  if (!process.env.GEMINI_API_KEY) return { handoff: true, text: '' }

  const systemInstruction = `You are the official customer-facing assistant of a business, replying to inbound Messenger/Instagram messages on its behalf.

STRICT RULES:
1. Reply in the SAME language the customer wrote in (most often Georgian). Sound like a warm, competent human rep — concise, no robotic tone.
2. Answer using ONLY the COMPANY INFORMATION below. Never invent or guess prices, timelines, availability, promises, or any fact that is not explicitly written there.
3. If the customer asks something whose answer is NOT clearly present in the information — a price or timeframe that isn't listed, booking/scheduling, a complaint, an account/personal matter, or anything you are not sure about — you MUST NOT guess and you MUST NOT reply with a generic greeting like "how can I help you". Instead output EXACTLY this token and nothing else: ${HANDOFF}
4. Greet back ONLY when the customer's message is itself purely a greeting with no real question. The moment there is an actual question, either answer it from the information or output ${HANDOFF}.
5. Do not repeat yourself. Read what was already said in the conversation.

# COMPANY INFORMATION
${knowledge?.trim() || '(the business has not provided any information yet — in that case you can only greet; for anything else output ' + HANDOFF + ')'}`

  const contents = `Here is the conversation so far (most recent last):

${transcript || '(empty)'}

Write the reply to the customer's LAST message now — in their language — using only the company information. If you cannot answer it from that information, output ${HANDOFF} and nothing else.`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
      },
    })
    const text = (res.text ?? '').trim()
    if (!text || text.includes(HANDOFF)) return { handoff: true, text: '' }
    return { handoff: false, text }
  } catch {
    // On any AI failure, hand off rather than stay silent.
    return { handoff: true, text: '' }
  }
}
