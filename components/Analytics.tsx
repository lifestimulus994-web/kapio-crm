'use client'

import { useEffect, useState } from 'react'
import {
  MessageSquare,
  Bot,
  CalendarCheck,
  Flame,
  Target,
  DollarSign,
  Users,
  AlertCircle,
} from 'lucide-react'

type Stats = {
  messages_in: number
  messages_out: number
  conversations: number
  needs_human: number
  resolution_rate: number
  bookings: number
  hot_leads: number
  leads_this_month: number
  cost_usd: number
}

function Card({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof MessageSquare
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
        <Icon size={15} className={accent ?? 'text-slate-400'} />
        {label}
      </div>
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export default function Analytics() {
  const [s, setS] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/analytics', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setS(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-semibold text-slate-100">ანალიტიკა</h1>
      <p className="mb-6 text-xs text-slate-500">AI-ს და შემოსულების მაჩვენებლები — ამ თვეში.</p>

      {loading ? (
        <div className="text-sm text-slate-500">იტვირთeba…</div>
      ) : !s ? (
        <div className="text-sm text-slate-500">მონაცემი ვერ ჩაიტვირთა.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Card
            Icon={Bot}
            label="AI-მ დამოუკიდებლად"
            value={`${s.resolution_rate}%`}
            sub="ადამიანის ჩარევის გარეშე"
            accent="text-emerald-400"
          />
          <Card
            Icon={CalendarCheck}
            label="დაჯავშნილი კონსულტაცია"
            value={s.bookings}
            accent="text-emerald-400"
          />
          <Card Icon={Flame} label="ცხელი ლიდი" value={s.hot_leads} sub="ქულა ≥ 55" accent="text-amber-400" />
          <Card Icon={Target} label="ახალი ლიდი" value={s.leads_this_month} accent="text-emerald-400" />
          <Card Icon={MessageSquare} label="შემოსული მესიჯი" value={s.messages_in} accent="text-sky-400" />
          <Card Icon={MessageSquare} label="გაგზავნილი პასუხი" value={s.messages_out} accent="text-slate-400" />
          <Card Icon={Users} label="საუბრები" value={s.conversations} />
          <Card
            Icon={AlertCircle}
            label="ელოდeba ადამიანს"
            value={s.needs_human}
            accent="text-amber-400"
          />
          <Card
            Icon={DollarSign}
            label="AI-ს ხარჯი"
            value={`$${s.cost_usd}`}
            sub="ამ თვეში"
            accent="text-violet-400"
          />
        </div>
      )}
    </div>
  )
}
