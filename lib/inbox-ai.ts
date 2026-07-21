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

export type BookingExtract = {
  wants_booking: boolean
  name: string | null
  phone: string | null
  slot_choice: number | null // 1-based index into the slots we last offered
  confirmed: boolean // customer said yes to the confirmation
  cancel: boolean
}

export type Decision = {
  reply: string
  handoff: boolean
  intent: string
  interest_level: 'weak' | 'medium' | 'high'
  signals: LeadSignals
  offered_consultation: boolean
  opt_out: boolean
  booking: BookingExtract
  usage: { inputTokens: number; outputTokens: number }
}

export type BookingContext = {
  enabled: boolean
  stage: string // none | collecting | proposed | awaiting_confirm | booked
  knownName: string | null
  knownPhone: string | null
  proposedSlots: string[] // human labels of the numbered slots we last offered
}

const NO_BOOKING: BookingExtract = {
  wants_booking: false,
  name: null,
  phone: null,
  slot_choice: null,
  confirmed: false,
  cancel: false,
}

const FALLBACK: Decision = {
  reply: DEFAULT_HOLDING,
  handoff: true,
  intent: 'unknown',
  interest_level: 'weak',
  signals: {},
  offered_consultation: false,
  opt_out: false,
  booking: NO_BOOKING,
  usage: { inputTokens: 0, outputTokens: 0 },
}

export async function generateDecision(
  knowledge: string,
  tone: string,
  transcript: string,
  alreadyGreeted: boolean,
  offersMade: number,
  booking: BookingContext
): Promise<Decision> {
  if (!process.env.GEMINI_API_KEY) return FALLBACK

  const greetingRule = alreadyGreeted
    ? `You have ALREADY greeted and introduced yourself earlier in this conversation. Do NOT greet again and do NOT re-introduce the business. Your reply must NOT begin with any greeting word (გამარჯობა / მოგესალმებით / სალამი / hello). Just answer the latest message directly and move the conversation forward.`
    : `This is your first reply: greet warmly, briefly introduce the business by name (from the information), then address the message.`

  const capRule =
    offersMade >= 2
      ? `You have already offered a free consultation ${offersMade} times in this thread — do NOT offer it again unless the customer just gave a strong new buying signal.`
      : `You may offer a free consultation when it fits (see interest rules).`

  // Booking guidance is only added when the workspace enabled booking.
  const bookingRule = !booking.enabled
    ? ''
    : `
# BOOKING (a consultation can be booked in-chat)
Current booking stage: ${booking.stage}. Known name: ${booking.knownName || '—'}. Known phone: ${booking.knownPhone || '—'}.
${booking.proposedSlots.length ? `Slots we just offered (numbered): ${booking.proposedSlots.map((s, i) => `${i + 1}) ${s}`).join('; ')}` : ''}
- If the customer wants a consultation/meeting/call (or interest is high), set booking.wants_booking=true. Before slots can be offered we need BOTH a name and a phone number: if either is missing, your reply should warmly ask for the missing one; extract any name/phone the customer gives into booking.name / booking.phone.
- Do NOT invent available times yourself — the system offers real slots. When slots have been offered (stage "proposed") and the customer picks one, set booking.slot_choice to the matching slot's NUMBER (1-based); match phrasings like "სამშაბ 14:00" to the right number.
- When stage is "awaiting_confirm" and the customer agrees (კი/დიახ/კარგი/დამიდასტურე), set booking.confirmed=true. If they decline or want a different time, set booking.cancel=true.`

  const systemInstruction = `You are the official customer-facing assistant of a business, replying to inbound Messenger/Instagram messages. Sound like a real, warm human rep — never robotic.

# VOICE / TONE
${tone?.trim() || DEFAULT_TONE}

# COMPANY INFORMATION (the only source of facts)
${knowledge?.trim() || '(the business has not provided information yet)'}

# REPLY RULES
1. Reply in the customer's language (usually Georgian).
2. ${greetingRule}
3. Always ANSWER the customer's latest message with real content. If they ask about price / services / timeline and the answer is in the information, you MUST give the actual details (e.g. the price ranges) — a reply that is ONLY a greeting or "how can I help you?" is FORBIDDEN when the customer asked a concrete question. Never repeat yourself. Never invent facts not in the information.
4. Vague/conversational messages ("can you help?", "I have a question"): stay engaged, ask what they need. Do NOT hand off these.
5. Interest handling:
   - WEAK interest (general question): answer + at most ONE relevant follow-up question. No pushy selling.
   - MEDIUM interest (describes a need, asks price/timeline): clarify the need, then it's fine to offer a free consultation.
   - HIGH interest ("I want a consultation", "call me", "how do we start", gives their number): go straight to offering/arranging the consultation — no extra selling.
6. ${capRule}
7. HAND OFF only when the customer asks for a SPECIFIC fact/commitment genuinely NOT in the information (a price/timeframe not listed, a complaint, an account/personal matter). Booking a consultation is NOT a handoff — handle it via the booking flow. When handing off, set handoff=true and make "reply" a short warm holding message (a colleague will reply shortly). Do NOT invent the answer.
8. If the customer asks to stop being messaged, set opt_out=true and reply with a brief polite acknowledgement.
${bookingRule}

# OUTPUT — return ONLY this JSON object, nothing else:
{
  "reply": "the message to send the customer, in their language",
  "handoff": false,
  "opt_out": false,
  "intent": "short label e.g. greeting | pricing_question | timeline_question | consultation_request | service_question | complaint | other",
  "interest_level": "weak | medium | high",
  "offered_consultation": false,
  "booking": { "wants_booking": false, "name": null, "phone": null, "slot_choice": null, "confirmed": false, "cancel": false },
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
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    })
    const usage = {
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    }
    const raw = (res.text ?? '').trim()
    const parsed = JSON.parse(raw) as Partial<Decision>
    const reply = (parsed.reply ?? '').trim()
    if (!reply) return { ...FALLBACK, usage }
    const b: Partial<BookingExtract> = parsed.booking ?? {}
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
      booking: {
        wants_booking: !!b.wants_booking,
        name: b.name ?? null,
        phone: b.phone ?? null,
        slot_choice: typeof b.slot_choice === 'number' ? b.slot_choice : null,
        confirmed: !!b.confirmed,
        cancel: !!b.cancel,
      },
      usage,
    }
  } catch {
    return FALLBACK
  }
}
