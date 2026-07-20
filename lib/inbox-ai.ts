import { GoogleGenAI } from '@google/genai'

// ---------------------------------------------------------------------------
// Customer-facing auto-reply brain. Answers inbound messages as a warm human
// rep would — using the business's knowledge for facts and its tone for voice.
// It engages with greetings and vague/conversational messages instead of
// bailing; it only hands off when the customer asks for a SPECIFIC fact or
// commitment that genuinely isn't in the knowledge, and even then it sends a
// short warm holding message so the customer is never left on silence.
// ---------------------------------------------------------------------------

const HANDOFF = '[[HANDOFF]]'
const DEFAULT_HOLDING = 'ერთი წუთით — კოლეგა მალე დაგიკავშირდებათ 🙏'
const DEFAULT_TONE =
  'თბილი, მეგობრული და თავდაჯერებული. მიმართე თავაზიანად („თქვენ"). ისაუბრე ბუნებრივად, ცოცხლად, როგორც კარგი ადამიანი-კონსულტანტი. ზომიერად გამოიყენე ემოჯი. მოკლედ, მაგრამ გულთბილად.'

export type AutoReply = { handoff: boolean; text: string }

export async function generateReply(
  knowledge: string,
  tone: string,
  transcript: string
): Promise<AutoReply> {
  if (!process.env.GEMINI_API_KEY) return { handoff: true, text: DEFAULT_HOLDING }

  const systemInstruction = `You are the official customer-facing assistant of a business, replying to inbound Messenger/Instagram messages on its behalf. You must sound like a real, warm human representative — never robotic, never a bare one-word reply.

# VOICE / TONE (how you must speak)
${tone?.trim() || DEFAULT_TONE}

# COMPANY INFORMATION (the only source of facts you may use)
${knowledge?.trim() || '(the business has not provided information yet)'}

# HOW TO BEHAVE
1. Reply in the SAME language the customer wrote in (usually Georgian).
2. GREETINGS: if the message is just a greeting/opener, greet back warmly, briefly introduce the business by name (from the information), and invite their question. Never reply with a bare "გამარჯობა!".
3. CONVERSATIONAL / VAGUE messages ("can you help me?", "I have a question", "are you there?"): stay engaged — warmly say yes and ask what they need or briefly offer what you can help with. NEVER hand these off.
4. SPECIFIC QUESTIONS: answer using ONLY the company information. Never invent or guess prices, timelines, availability, or promises that aren't written there.
5. HAND OFF ONLY when the customer asks for a SPECIFIC fact or commitment that is genuinely not in the information — a price or timeframe that isn't listed, a booking/scheduling, a complaint, or an account/personal matter. When (and only when) that happens, output on the FIRST line exactly:
${HANDOFF}
and then, on the next line, a short warm holding message in the customer's language telling them a colleague will get back to them shortly. Do NOT invent the missing answer.`

  const contents = `Conversation so far (most recent last):

${transcript || '(empty)'}

Write your reply to the customer's LAST message now, following the rules and tone.`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { systemInstruction, temperature: 0.5 },
    })
    const raw = (res.text ?? '').trim()

    if (raw.includes(HANDOFF)) {
      // The model chose to hand off; whatever it wrote after the token is the
      // warm holding message we send the customer before a human takes over.
      const holding = raw.replace(HANDOFF, '').trim()
      return { handoff: true, text: holding || DEFAULT_HOLDING }
    }
    if (!raw) return { handoff: true, text: DEFAULT_HOLDING }
    return { handoff: false, text: raw }
  } catch {
    return { handoff: true, text: DEFAULT_HOLDING }
  }
}
