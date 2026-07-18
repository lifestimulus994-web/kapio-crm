import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import { Workflow } from 'lucide-react'
import Link from 'next/link'
import NewBoardButton from '@/components/NewBoardButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'სტრატეგიის დაფები — Kapio CRM' }

type BoardRow = {
  id: string
  name: string
  data: { nodes?: unknown[] }
  updated_at: string
  author: { full_name: string | null; email: string } | null
}

export default async function BoardsPage() {
  const me = await requireMember()

  const { data, error } = await supabase
    .from('boards')
    .select('id, name, data, updated_at, author:members!boards_created_by_fkey(full_name, email)')
    .eq('workspace_id', me.workspace_id)
    .order('updated_at', { ascending: false })

  if (error) {
    return (
      <div className="p-8 text-sm text-red-400">
        დაფები ვერ ჩაიტვირთა: {error.message}
        <p className="mt-2 text-xs text-slate-500">
          (თუ ცხრილი არ არსებობს — გაუშვი migration-boards.sql Supabase-ის SQL
          Editor-ში.)
        </p>
      </div>
    )
  }

  const boards = (data ?? []) as unknown as BoardRow[]

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            სტრატეგიის დაფები
          </h1>
          <p className="text-xs text-slate-500">
            Brain-map დაფები გაყიდვების სტრატეგიისთვის — საერთოა მთელი გუნდისთვის
          </p>
        </div>
        <NewBoardButton />
      </div>

      {boards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-800 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-900/40 text-emerald-400">
            <Workflow size={24} />
          </div>
          <p className="text-sm text-slate-400">ჯერ არცერთი დაფა არ გაქვს.</p>
          <p className="max-w-sm text-xs text-slate-600">
            შექმენი პირველი — მწვანე ფურცლებით და ისრებით დაწერე გაყიდვების
            სტრატეგია ნაბიჯ-ნაბიჯ.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/boards/${b.id}`}
              className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-emerald-800/60 hover:bg-slate-800/60"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-900/40 text-emerald-400">
                <Workflow size={18} />
              </div>
              <p className="truncate text-sm font-semibold text-slate-100 group-hover:text-emerald-300">
                {b.name}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {(b.data?.nodes?.length ?? 0)} ფურცელი ·{' '}
                {new Date(b.updated_at).toLocaleDateString('ka-GE', {
                  day: 'numeric',
                  month: 'short',
                })}
                {b.author && (
                  <> · {b.author.full_name || b.author.email}</>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
