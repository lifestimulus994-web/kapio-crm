import { requireOwner } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'
import TeamManager from '@/components/team/TeamManager'
import type { Member } from '@/lib/auth'
import { getMonthlyUsageUsd, PLAN_AI_LIMIT_USD } from '@/lib/ai-usage'

const planLabel: Record<string, string> = {
  starter: 'Starter',
  business: 'Business',
  pro: 'Pro',
}

export default async function TeamPage() {
  const me = await requireOwner()

  const [{ data: members }, { data: workspace }, aiUsedUsd] = await Promise.all([
    admin
      .from('members')
      .select('*')
      .eq('workspace_id', me.workspace_id)
      .order('created_at', { ascending: true }),
    admin.from('workspaces').select('plan').eq('id', me.workspace_id).maybeSingle(),
    getMonthlyUsageUsd(me.workspace_id),
  ])

  const plan = (workspace as { plan?: string } | null)?.plan ?? 'starter'
  const aiLimitUsd = PLAN_AI_LIMIT_USD[plan] ?? PLAN_AI_LIMIT_USD.starter ?? null
  const aiUsagePct = aiLimitUsd ? Math.min(100, (aiUsedUsd / aiLimitUsd) * 100) : 0

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8">
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="text-xl font-semibold text-slate-100">გუნდი</h1>
        <span className="rounded-full bg-emerald-950/40 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/60">
          {planLabel[plan] ?? plan}
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        დაამატე ან წაშალე წევრები. თითოეულს საკუთარი ელფოსტა და პაროლი უნდა
        მიენიჭოს.
      </p>

      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">AI გამოყენება (ამ თვეში)</span>
          <span className="font-medium text-slate-300">
            ${aiUsedUsd.toFixed(2)}
            {aiLimitUsd !== null ? ` / $${aiLimitUsd}` : ' · ულიმიტო'}
          </span>
        </div>
        {aiLimitUsd !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${aiUsagePct >= 100 ? 'bg-red-500' : aiUsagePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${aiUsagePct}%` }}
            />
          </div>
        )}
      </div>

      <TeamManager members={(members as Member[]) ?? []} currentUserId={me.id} />
    </div>
  )
}
