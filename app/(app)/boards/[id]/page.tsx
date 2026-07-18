import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import StrategyBoard, { type BoardData } from '@/components/StrategyBoard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'სტრატეგიის დაფა — Kapio CRM' }

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const me = await requireMember()
  const { id } = await params

  const { data, error } = await supabase
    .from('boards')
    .select('id, name, data')
    .eq('id', id)
    .eq('workspace_id', me.workspace_id)
    .single()

  if (error || !data) notFound()

  const boardData: BoardData = {
    nodes: Array.isArray(data.data?.nodes) ? data.data.nodes : [],
    edges: Array.isArray(data.data?.edges) ? data.data.edges : [],
  }

  return (
    <div className="h-full">
      <StrategyBoard
        boardId={data.id}
        initialName={data.name}
        initialData={boardData}
      />
    </div>
  )
}
