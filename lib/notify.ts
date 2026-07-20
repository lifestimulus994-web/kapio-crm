import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Write notification rows. Lead/task assignment is handled by DB triggers;
// this is used for app-level events (inbox messages, AI handoff) that need to
// fan out to every member of a workspace.
// ---------------------------------------------------------------------------

export type NotifyInput = {
  workspaceId: string
  type: 'message' | 'handoff' | 'lead' | 'task'
  title: string
  body?: string | null
  link?: string | null
}

// Notify every active member of a workspace (inbox is workspace-shared).
export async function notifyWorkspace(input: NotifyInput): Promise<void> {
  const { data: members } = await supabase
    .from('members')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('status', 'approved')
  if (!members || members.length === 0) return

  const rows = members.map((m) => ({
    workspace_id: input.workspaceId,
    member_id: m.id,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  }))
  await supabase.from('notifications').insert(rows)
}
