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
// Google Search grounding: the first 1,500 grounded prompts EACH DAY are
// free (shared across the whole Google Cloud project — i.e. across every
// workspace in this app, since they all call through the same API key),
// then $35 per 1,000 after that. Pass how many grounded calls have already
// happened today (project-wide, see getGroundedCallsToday in ai-usage.ts)
// so a light user's lookups land in the free allotment instead of always
// being charged the worst-case per-call rate.
const GROUNDED_PROMPT_COST = 35 / 1000
const FREE_GROUNDED_PER_DAY = 1500

export function groundingCostUsd(priorGroundedCallsToday: number): number {
  return priorGroundedCallsToday < FREE_GROUNDED_PER_DAY ? 0 : GROUNDED_PROMPT_COST
}

export function estimateCostUsd(usage: {
  inputTokens: number
  outputTokens: number
  audioInput?: boolean
}): number {
  const inputRate = usage.audioInput
    ? PRICE_PER_MILLION.audioInput
    : PRICE_PER_MILLION.textInput
  const inputCost = (usage.inputTokens / 1_000_000) * inputRate
  const outputCost = (usage.outputTokens / 1_000_000) * PRICE_PER_MILLION.output
  return inputCost + outputCost
}
