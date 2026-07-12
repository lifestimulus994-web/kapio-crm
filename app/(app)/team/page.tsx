import { requireOwner } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'
import TeamManager from '@/components/team/TeamManager'
import type { Member } from '@/lib/auth'

const planLabel: Record<string, string> = {
  starter: 'Starter',
  business: 'Business',
  pro: 'Pro',
}

export default async function TeamPage() {
  const me = await requireOwner()

  const [{ data: members }, { data: workspace }] = await Promise.all([
    admin
      .from('members')
      .select('*')
      .eq('workspace_id', me.workspace_id)
      .order('created_at', { ascending: true }),
    admin.from('workspaces').select('plan').eq('id', me.workspace_id).maybeSingle(),
  ])

  const plan = (workspace as { plan?: string } | null)?.plan ?? 'starter'

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8">
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="text-xl font-semibold text-slate-100">გუნდი</h1>
        <span className="rounded-full bg-emerald-950/40 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/60">
          {planLabel[plan] ?? plan}
        </span>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        დაამატე ან წაშალე წევრები. თითოეულს საკუთარი ელფოსტა და პაროლი უნდა
        მიენიჭოს.
      </p>
      <TeamManager members={(members as Member[]) ?? []} currentUserId={me.id} />
    </div>
  )
}
