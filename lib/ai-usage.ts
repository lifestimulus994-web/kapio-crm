import { supabase } from '@/lib/supabase'
import { estimateCostUsd, groundingCostUsd } from '@/lib/ai-cost'

// Monthly AI spend cap per plan, in USD. null = no automatic cap (Pro is
// negotiated directly, not enforced here).
export const PLAN_AI_LIMIT_USD: Record<string, number | null> = {
  starter: 5,
  business: 10,
  pro: null,
}

function startOfMonthIso(): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

// Georgia runs UTC+4, no DST — build "today" against the business's actual
// day boundary, not the server's (UTC on Vercel).
function startOfTodayTbilisiIso(): string {
  const todayInTbilisi = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tbilisi',
  }).format(new Date())
  return new Date(`${todayInTbilisi}T00:00:00+04:00`).toISOString()
}

// How many grounded (Google Search) calls have already happened TODAY,
// across every workspace — Google's 1,500/day free grounding allotment is
// shared per API key/project, not per tenant.
async function getGroundedCallsToday(): Promise<number> {
  const { count } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('grounded', true)
    .gte('created_at', startOfTodayTbilisiIso())
  return count ?? 0
}

export async function getMonthlyUsageUsd(workspaceId: string): Promise<number> {
  const { data } = await supabase
    .from('ai_usage')
    .select('cost_usd')
    .eq('workspace_id', workspaceId)
    .gte('created_at', startOfMonthIso())
  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd), 0)
}

export type BudgetStatus = {
  allowed: boolean
  usedUsd: number
  limitUsd: number | null
}

// Call BEFORE making a Gemini request that would cost money, so an
// over-budget workspace never even reaches the API.
export async function checkAiBudget(
  workspaceId: string,
  plan: string
): Promise<BudgetStatus> {
  const limitUsd = PLAN_AI_LIMIT_USD[plan] ?? PLAN_AI_LIMIT_USD.starter ?? null
  if (limitUsd === null) return { allowed: true, usedUsd: 0, limitUsd: null }
  const usedUsd = await getMonthlyUsageUsd(workspaceId)
  return { allowed: usedUsd < limitUsd, usedUsd, limitUsd }
}

// Call AFTER a Gemini request completes (success or not — a failed call
// often still consumed input tokens) to record what it actually cost.
// Never throws: logging usage must never break the caller's real response.
export async function logAiUsage(params: {
  workspaceId: string
  route: string
  inputTokens: number
  outputTokens: number
  audioInput?: boolean
  grounded?: boolean
}): Promise<void> {
  try {
    const tokenCost = estimateCostUsd(params)
    const groundingCost = params.grounded
      ? groundingCostUsd(await getGroundedCallsToday())
      : 0
    const cost_usd = tokenCost + groundingCost
    await supabase.from('ai_usage').insert({
      workspace_id: params.workspaceId,
      route: params.route,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      audio_input: !!params.audioInput,
      grounded: !!params.grounded,
      cost_usd,
    })
  } catch {
    // Never let usage logging break the actual AI response.
  }
}

export function budgetExceededMessage(status: BudgetStatus): string {
  return `ამ თვის AI-ლიმიტი ($${status.limitUsd}) ამოწურულია (გამოყენებულია $${status.usedUsd.toFixed(2)}). ლიმიტი განახლდება მომდევნო თვეში, ან პაკეტის განახლება მოგმართეთ.`
}
