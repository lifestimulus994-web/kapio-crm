import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { STAGES, type Opportunity, type Task } from '@/types'
import {
  ChevronLeft,
  Pencil,
  Building2,
  User,
  Mail,
  Phone,
  Calendar,
  Megaphone,
  Coins,
  CheckCircle2,
  Circle,
  Plus,
  Clock,
} from 'lucide-react'
import { formatCurrency, formatDate, formatDateTime, fullName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const stageChip: Record<string, string> = {
  'New Lead': 'bg-slate-700/80 text-slate-300',
  Contacted: 'bg-blue-900/50 text-blue-300',
  'Needs Identified': 'bg-violet-900/50 text-violet-300',
  'Proposal Sent': 'bg-amber-900/50 text-amber-300',
  Negotiation: 'bg-orange-900/50 text-orange-300',
  Won: 'bg-emerald-900/50 text-emerald-300',
  Lost: 'bg-red-900/50 text-red-300',
}

// The linear path (closers Won/Lost are shown separately as buttons).
const PATH = STAGES.filter((s) => s !== 'Won' && s !== 'Lost')

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [oppRes, tasksRes] = await Promise.all([
    supabase
      .from('opportunities')
      .select(
        '*, organization:organizations(id, name, email, phone), contact:contacts(id, first_name, last_name, phone, email)'
      )
      .eq('id', id)
      .single(),
    supabase
      .from('tasks')
      .select('*')
      .eq('opportunity_id', id)
      .order('due_date', { ascending: true }),
  ])

  if (oppRes.error || !oppRes.data) {
    return <div className="p-8 text-red-400 text-sm">Opportunity not found</div>
  }

  const opp = oppRes.data as Opportunity
  const tasks = (tasksRes.data ?? []) as Task[]
  // The detail fields only exist once the opportunities migration has been run.
  const migrated = 'owner' in opp

  async function setStage(formData: FormData) {
    'use server'
    const stage = formData.get('stage') as string
    if (!STAGES.includes(stage as (typeof STAGES)[number])) return
    const { error } = await supabase
      .from('opportunities')
      .update({ stage })
      .eq('id', id)
    if (error) throw new Error(error.message)
    revalidatePath(`/opportunities/${id}`)
    revalidatePath('/')
  }

  const currentIdx = PATH.indexOf(opp.stage as (typeof PATH)[number])
  const isClosed = opp.stage === 'Won' || opp.stage === 'Lost'

  const planned = tasks.filter((t) => t.status !== 'done')
  const completed = tasks.filter((t) => t.status === 'done')

  const meta = [
    {
      Icon: Coins,
      label: 'Amount',
      value: formatCurrency(Number(opp.value_gel)),
      accent: true,
    },
    {
      Icon: Calendar,
      label: 'Time Frames',
      value:
        opp.start_date || opp.close_date
          ? `${opp.start_date ? formatDate(opp.start_date) : '—'} – ${opp.close_date ? formatDate(opp.close_date) : '—'}`
          : '—',
    },
    { Icon: Megaphone, label: 'Source', value: opp.source || '—' },
    { Icon: User, label: 'Owner', value: opp.owner || '—' },
  ]

  return (
    <div className="px-6 py-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <Link
          href="/"
          className="mt-1 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-slate-100">{opp.title}</h1>
          <p className="mt-1 inline-flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`px-2 py-0.5 rounded-full ${stageChip[opp.stage] ?? 'bg-slate-700 text-slate-300'}`}
            >
              {opp.stage}
            </span>
            <span>Created {formatDate(opp.created_at)}</span>
          </p>
        </div>
        <Link
          href={`/opportunities/${id}/edit`}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-none"
        >
          <Pencil size={14} />
          Edit
        </Link>
      </div>

      {/* Stage progress bar */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {PATH.map((stage, i) => {
          const done = !isClosed && i < currentIdx
          const current = !isClosed && i === currentIdx
          return (
            <form key={stage} action={setStage} className="contents">
              <input type="hidden" name="stage" value={stage} />
              <button
                type="submit"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  current
                    ? 'bg-emerald-600 text-white'
                    : done
                      ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {stage}
              </button>
            </form>
          )
        })}
        <span className="mx-1 text-slate-700">·</span>
        {(['Won', 'Lost'] as const).map((stage) => (
          <form key={stage} action={setStage} className="contents">
            <input type="hidden" name="stage" value={stage} />
            <button
              type="submit"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                opp.stage === stage
                  ? stage === 'Won'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {stage === 'Won' ? '✓ Won' : '✕ Lost'}
            </button>
          </form>
        ))}
      </div>

      {!migrated && (
        <div className="mb-5 rounded-xl border border-amber-900/50 bg-amber-900/15 px-4 py-2.5 text-xs text-amber-300">
          Owner, Source and Time Frames need a quick database migration — run the
          opportunities <span className="font-mono">alter table</span> block in{' '}
          <span className="font-mono">schema.sql</span> to enable them.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Meta cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {meta.map(({ Icon, label, value, accent }) => (
              <div
                key={label}
                className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon size={12} className="text-slate-600" />
                  <span className="text-xs text-slate-500">{label}</span>
                </div>
                <p
                  className={`text-sm truncate ${accent ? 'font-bold text-emerald-400' : 'text-slate-200'}`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Customer */}
          <div>
            <h2 className="text-sm font-medium text-slate-300 mb-3">Customer</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Company */}
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 size={12} className="text-slate-600" />
                  <span className="text-xs text-slate-500">Company</span>
                </div>
                {opp.organization ? (
                  <>
                    <Link
                      href={`/organizations/${opp.organization.id}`}
                      className="text-sm font-medium text-slate-200 hover:text-emerald-400 transition-colors"
                    >
                      {opp.organization.name}
                    </Link>
                    <div className="mt-2 space-y-1">
                      {opp.organization.phone && (
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Phone size={11} /> {opp.organization.phone}
                        </p>
                      )}
                      {opp.organization.email && (
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Mail size={11} /> {opp.organization.email}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">No company linked</p>
                )}
              </div>

              {/* Contact */}
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <User size={12} className="text-slate-600" />
                  <span className="text-xs text-slate-500">Contact</span>
                </div>
                {opp.contact ? (
                  <>
                    <Link
                      href={`/contacts/${opp.contact.id}`}
                      className="text-sm font-medium text-slate-200 hover:text-emerald-400 transition-colors"
                    >
                      {fullName(opp.contact)}
                    </Link>
                    <div className="mt-2 space-y-1">
                      {opp.contact.phone && (
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Phone size={11} /> {opp.contact.phone}
                        </p>
                      )}
                      {opp.contact.email && (
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Mail size={11} /> {opp.contact.email}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">No contact linked</p>
                )}
              </div>
            </div>
          </div>

          {/* Pain points / next action / notes */}
          {(opp.pain_points || opp.next_action || opp.notes) && (
            <div className="space-y-2.5">
              {opp.next_action && (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1.5">Next Action</p>
                  <p className="text-sm text-slate-300">{opp.next_action}</p>
                </div>
              )}
              {opp.pain_points && (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1.5">Pain Points</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {opp.pain_points}
                  </p>
                </div>
              )}
              {opp.notes && (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1.5">Notes</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {opp.notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activities feed */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">Activities</h2>
            <Link
              href="/tasks/new"
              className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              <Plus size={13} /> Schedule
            </Link>
          </div>

          {/* Planned */}
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <Clock size={11} /> Planned
            </p>
            <div className="space-y-2">
              {planned.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  className="flex items-start gap-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60 p-3 hover:border-slate-600 transition-colors"
                >
                  <Circle
                    size={14}
                    className={
                      t.status === 'in_progress'
                        ? 'mt-0.5 text-amber-500'
                        : 'mt-0.5 text-slate-600'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200 leading-snug">{t.title}</p>
                    {t.due_date && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Due {formatDate(t.due_date)}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
              {planned.length === 0 && (
                <p className="rounded-xl bg-slate-800/30 px-3 py-4 text-center text-xs text-slate-600">
                  No scheduled activities
                </p>
              )}
            </div>
          </div>

          {/* Activity log */}
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Activity
            </p>
            <div className="space-y-2">
              {completed.map((t) => (
                <div key={t.id} className="flex items-start gap-2.5 px-1">
                  <CheckCircle2 size={14} className="mt-0.5 text-emerald-500 flex-none" />
                  <p className="text-sm text-slate-400 leading-snug line-through">
                    {t.title}
                  </p>
                </div>
              ))}
              <div className="flex items-start gap-2.5 px-1">
                <Circle size={14} className="mt-0.5 text-slate-600 flex-none" />
                <p className="text-xs text-slate-500 leading-snug">
                  Opportunity created · {formatDateTime(opp.created_at)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
