import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { STAGES, type Opportunity, type Stage } from '@/types'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const stageDot: Record<string, string> = {
  'New Lead': 'bg-slate-500',
  'Contacted': 'bg-blue-500',
  'Needs Identified': 'bg-violet-500',
  'Proposal Sent': 'bg-amber-500',
  'Negotiation': 'bg-orange-500',
  'Won': 'bg-emerald-500',
  'Lost': 'bg-red-500',
}

export default async function PipelinePage() {
  const { data, error } = await supabase
    .from('opportunities')
    .select(
      '*, organization:organizations(id, name), contact:contacts(id, first_name, last_name)'
    )
    .eq('archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load pipeline: {error.message}
      </div>
    )
  }

  const opportunities = (data ?? []) as Opportunity[]

  const byStage = STAGES.reduce(
    (acc, stage) => {
      acc[stage] = opportunities.filter((o) => o.stage === stage)
      return acc
    },
    {} as Record<Stage, Opportunity[]>
  )

  const activeValue = opportunities
    .filter((o) => o.stage !== 'Lost' && o.stage !== 'Won')
    .reduce((s, o) => s + Number(o.value_gel), 0)

  const wonValue = opportunities
    .filter((o) => o.stage === 'Won')
    .reduce((s, o) => s + Number(o.value_gel), 0)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Pipeline</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {opportunities.length} deals · Active{' '}
            <span className="text-slate-400">{formatCurrency(activeValue)}</span> · Won{' '}
            <span className="text-emerald-500">{formatCurrency(wonValue)}</span>
          </p>
        </div>
        <Link
          href="/opportunities/new"
          className="self-start bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Opportunity
        </Link>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto px-4 sm:px-6 py-5">
        <div className="flex gap-3 h-full" style={{ minWidth: 'max-content' }}>
          {STAGES.map((stage) => {
            const cols = byStage[stage]
            const colValue = cols.reduce((s, o) => s + Number(o.value_gel), 0)
            return (
              <div key={stage} className="w-56 flex flex-col">
                {/* Column header */}
                <div className="flex items-center justify-between mb-2.5 px-0.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${stageDot[stage]}`} />
                    <span className="text-xs font-medium text-slate-400">
                      {stage}
                    </span>
                    <span className="text-xs text-slate-600 bg-slate-800 rounded-full px-1.5">
                      {cols.length}
                    </span>
                  </div>
                  {cols.length > 0 && (
                    <span className="text-xs text-slate-600">
                      {formatCurrency(colValue)}
                    </span>
                  )}
                </div>

                {/* Column body */}
                <div className="flex-1 bg-slate-800/30 rounded-xl p-2 space-y-2 min-h-[160px]">
                  {cols.map((opp) => (
                    <Link
                      key={opp.id}
                      href={`/opportunities/${opp.id}`}
                      className="block bg-slate-800 border border-slate-700/80 rounded-lg p-3 hover:border-slate-600 transition-colors"
                    >
                      <p className="text-xs font-semibold text-slate-200 leading-snug">
                        {opp.organization?.name ?? '—'}
                      </p>
                      {opp.contact && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {opp.contact.first_name} {opp.contact.last_name}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1.5 leading-snug">
                        {opp.title}
                      </p>
                      <p className="text-sm font-bold text-emerald-400 mt-2">
                        {formatCurrency(Number(opp.value_gel))}
                      </p>
                    </Link>
                  ))}
                  {cols.length === 0 && (
                    <div className="flex items-center justify-center h-16">
                      <p className="text-xs text-slate-700">—</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
