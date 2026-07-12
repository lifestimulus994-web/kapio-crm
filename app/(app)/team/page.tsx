import { requireOwner } from '@/lib/auth'
import { supabase as admin } from '@/lib/supabase'
import TeamManager from '@/components/team/TeamManager'
import type { Member } from '@/lib/auth'

export default async function TeamPage() {
  const me = await requireOwner()

  const { data: members } = await admin
    .from('members')
    .select('*')
    .eq('workspace_id', me.workspace_id)
    .order('created_at', { ascending: true })

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8">
      <h1 className="mb-1 text-xl font-semibold text-slate-100">გუნდი</h1>
      <p className="mb-6 text-sm text-slate-500">
        დაამატე ან წაშალე წევრები. თითოეულს საკუთარი ელფოსტა და პაროლი უნდა
        მიენიჭოს.
      </p>
      <TeamManager members={(members as Member[]) ?? []} currentUserId={me.id} />
    </div>
  )
}
