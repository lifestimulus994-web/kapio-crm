// gemini-2.5-flash pricing (Standard tier, per Google's published rates —
// https://ai.google.dev/gemini-api/docs/pricing). An estimate, not a
// reconciliation against Google's actual invoice: good enough to gate a
// plan's monthly spend limit, not exact accounting. Re-check occasionally —
// Google does change these.
const PRICE_PER_MILLION = {
  textInput: 0.3,
  audioInput: 1.0,
  output: 2.5, // includes "thinking" output tokens
}
// Google Search grounding: 1,500 requests/day free, then $35 per 1,000
// grounded prompts. We don't track the free daily allotment per workspace
// (would need its own reset-at-midnight counter), so this slightly
// overcounts for light users — a conservative bias, appropriate for a spend
// guard.
const GROUNDED_PROMPT_COST = 35 / 1000

export function estimateCostUsd(usage: {
  inputTokens: number
  outputTokens: number
  audioInput?: boolean
  grounded?: boolean
}): number {
  const inputRate = usage.audioInput
    ? PRICE_PER_MILLION.audioInput
    : PRICE_PER_MILLION.textInput
  const inputCost = (usage.inputTokens / 1_000_000) * inputRate
  const outputCost = (usage.outputTokens / 1_000_000) * PRICE_PER_MILLION.output
  const groundingCost = usage.grounded ? GROUNDED_PROMPT_COST : 0
  return inputCost + outputCost + groundingCost
}
