// ---------------------------------------------------------------------------
// Deterministic lead scoring. The AI extracts boolean signals from a message;
// the SCORE is computed here from a fixed rules table — never trusted to the
// model's own intuition. Negation always wins ("I do NOT want a consultation"
// must not score as interest), which the extractor handles by only setting a
// signal true when it genuinely holds.
// ---------------------------------------------------------------------------

export type LeadSignals = {
  explicit_consultation_request?: boolean
  requested_call_or_meeting?: boolean
  gave_contact?: boolean // phone or email
  asked_price?: boolean
  asked_timeline?: boolean
  described_problem?: boolean
  stated_budget?: boolean
  is_decision_maker?: boolean
  urgent?: boolean
  multiple_questions?: boolean
  weak_interest?: boolean
  not_interested?: boolean
  opt_out?: boolean
  irrelevant?: boolean
}

const WEIGHTS: Record<keyof LeadSignals, number> = {
  explicit_consultation_request: 100,
  requested_call_or_meeting: 80,
  gave_contact: 40,
  asked_price: 15,
  asked_timeline: 15,
  described_problem: 20,
  stated_budget: 20,
  is_decision_maker: 15,
  urgent: 15,
  multiple_questions: 10,
  weak_interest: 5,
  not_interested: -100,
  opt_out: -1000,
  irrelevant: -50,
}

// Delta from a single message's signals. Callers accumulate this onto the
// conversation's running score (clamped to a sane range).
export function scoreDelta(signals: LeadSignals): number {
  let d = 0
  for (const k of Object.keys(WEIGHTS) as (keyof LeadSignals)[]) {
    if (signals[k]) d += WEIGHTS[k]
  }
  return d
}

export type ConsultationBand = 'book_now' | 'offer' | 'qualify' | 'answer_only'

// What the reply should aim for, from the running score + explicit request.
export function consultationBand(score: number, signals: LeadSignals): ConsultationBand {
  if (signals.opt_out || signals.not_interested) return 'answer_only'
  if (signals.explicit_consultation_request || signals.requested_call_or_meeting) return 'book_now'
  if (score >= 55) return 'offer'
  if (score >= 30) return 'qualify'
  return 'answer_only'
}
