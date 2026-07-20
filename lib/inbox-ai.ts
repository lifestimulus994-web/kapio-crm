import { GoogleGenAI } from '@google/genai'
import type { LeadSignals } from '@/lib/lead-score'

// ---------------------------------------------------------------------------
// Customer-facing auto-reply brain — phase 1: ONE structured call returns both
// the reply and the sales signals. The reply reads like a warm human rep; the
// signals feed the deterministic lead score (lib/lead-score). It answers only
// from the business knowledge, engages with greetings/vague messages, and
// hands off (with a warm holding line) only for specific unanswerable facts.
// ---------------------------------------------------------------------------

const DEFAULT_HOLDING = 'ერთი წუთით — კოლეგა მალე დაგიკავშირდებათ 🙏'
const DEFAULT_TONE =
  'თბილი, მეგობრული და თავდაჯერებული. მიმართე თავაზიანად („თქვენ"). ისაუბრე ბუნებრივად, ცოცხლად. ზომიერად გამოიყენე ემოჯი. მოკლედ, მაგრამ გულთბილად.'

export type Decision = {
  reply: string
  handoff: boolean
  intent: string
  interest_level: 'weak' | 'medium' | 'high'
  signals: LeadSignals
  offered_consultation: boolean
  opt_out: boolean
}

const FALLBACK: Decision = {
  reply: DEFAULT_HOLDING,
  handoff: true,
  intent: 'unknown',
  interest_level: 'weak',
  signals: {},
  offered_consultation: false,
  opt_out: false,
}

export async function generateDecision(
  knowledge: string,
  tone: string,
  transcript: string,
  alreadyGreeted: boolean,
  offersMade: number
): Promise<Decision> {
  if (!process.env.GEMINI_API_KEY) return FALLBACK

  const greetingRule = alreadyGreeted
    ? `You have ALREADY greeted and introduced yourself earlier. Do NOT greet again, do NOT re-introduce the business, do NOT repeat a previous reply — answer the latest message directly and move the conversation forward.`
    : `This is your first reply: greet warmly, briefly introduce the business by name (from the information), then address the message.`

  const capRule =
    offersMade >= 2
      ? `You have already offered a free consultation ${offersMade} times in this thread — do NOT offer it again unless the customer just gave a strong new buying signal.`
      : `You may offer a free consultation when it fits (see interest rules).`

  const systemInstruction = `You are the official customer-facing assistant of a business, replying to inbound Messenger/Instagram messages. Sound like a real, warm human rep — never robotic.

# VOICE / TONE
${tone?.trim() || DEFAULT_TONE}

# COMPANY INFORMATION (the only source of facts)
${knowledge?.trim() || '(the business has not provided information yet)'}

# REPLY RULES
1. Reply in the customer's language (usually Georgian).
2. ${greetingRule}
3. Always ANSWER the customer's latest message. Never deflect a real question with a greeting. Never repeat yourself. Never invent prices/timelines/facts not in the information.
4. Vague/conversational messages ("can you help?", "I have a question"): stay engaged, ask what they need. Do NOT hand off these.
5. Interest handling:
   - WEAK interest (general question): answer + at most ONE relevant follow-up question. No pushy selling.
   - MEDIUM interest (describes a need, asks price/timeline): clarify the need, then it's fine to offer a free consultation.
   - HIGH interest ("I want a consultation", "call me", "how do we start", gives their number): go straight to offering/arranging the consultation — no extra selling.
6. ${capRule}
7. HAND OFF only when the customer asks for a SPECIFIC fact/commitment genuinely NOT in the information (a price/timeframe not listed, a booking, a complaint, an account/personal matter). When handing off, set handoff=true and make "reply" a short warm holding message (a colleague will reply shortly). Do NOT invent the answer.
8. If the customer asks to stop being messaged, set opt_out=true and reply with a brief polite acknowledgement.

# OUTPUT — return ONLY this JSON object, nothing else:
{
  "reply": "the message to send the customer, in their language",
  "handoff": false,
  "opt_out": false,
  "intent": "short label e.g. greeting | pricing_question | timeline_question | consultation_request | service_question | complaint | other",
  "interest_level": "weak | medium | high",
  "offered_consultation": false,
  "signals": {
    "explicit_consultation_request": false,
    "requested_call_or_meeting": false,
    "gave_contact": false,
    "asked_price": false,
    "asked_timeline": false,
    "described_problem": false,
    "stated_budget": false,
    "is_decision_maker": false,
    "urgent": false,
    "multiple_questions": false,
    "weak_interest": false,
    "not_interested": false,
    "opt_out": false,
    "irrelevant": false
  }
}
Set each signal true ONLY if it genuinely holds for the LATEST customer message. Negation wins: "I do NOT want a consultation" means explicit_consultation_request=false and not_interested=true. "offered_consultation" must be true only if YOUR reply actually offers a consultation.`

  const contents = `Conversation so far (most recent last):

${transcript || '(empty)'}

Decide and reply to the customer's LAST message. Return only the JSON object.`

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    })
    const raw = (res.text ?? '').trim()
    const parsed = JSON.parse(raw) as Partial<Decision>
    const reply = (parsed.reply ?? '').trim()
    if (!reply) return FALLBACK
    return {
      reply,
      handoff: !!parsed.handoff,
      intent: parsed.intent ?? 'other',
      interest_level:
        parsed.interest_level === 'high' || parsed.interest_level === 'medium'
          ? parsed.interest_level
          : 'weak',
      signals: parsed.signals ?? {},
      offered_consultation: !!parsed.offered_consultation,
      opt_out: !!parsed.opt_out || !!parsed.signals?.opt_out,
    }
  } catch {
    return FALLBACK
  }
}
