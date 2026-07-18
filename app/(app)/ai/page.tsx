import { Bot } from 'lucide-react'
import AIChat from '@/components/AIChat'

export const metadata = { title: 'AI ასისტენტი — Kapio CRM' }

export default function AiPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-800 px-5 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
          <Bot size={18} />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-100">AI ასისტენტი</h1>
          <p className="text-[11px] text-slate-500">
            კითხვები, ჩანაწერები, ლიდების მოძებნა — ყველაფერი ერთ ჩატში
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AIChat variant="page" />
      </div>
    </div>
  )
}
