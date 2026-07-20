'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageSquare, AlertCircle, Target, ListTodo, CheckCheck } from 'lucide-react'

// ---------------------------------------------------------------------------
// Notification bell for the sidebar. Polls the current member's notification
// feed (things that happened without their action) and shows an unread badge +
// a dropdown. Clicking a notification marks it read and navigates to its link.
// ---------------------------------------------------------------------------

type Notification = {
  id: string
  type: 'message' | 'handoff' | 'lead' | 'task'
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

const ICONS = {
  message: { Icon: MessageSquare, cls: 'text-sky-400' },
  handoff: { Icon: AlertCircle, cls: 'text-amber-400' },
  lead: { Icon: Target, cls: 'text-emerald-400' },
  task: { Icon: ListTodo, cls: 'text-violet-400' },
} as const

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'ახლახ'
  if (s < 3600) return `${Math.floor(s / 60)} წთ`
  if (s < 86400) return `${Math.floor(s / 3600)} სთ`
  return new Date(iso).toLocaleDateString('ka-GE', { day: '2-digit', month: '2-digit' })
}

export default function NotificationBell() {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const d = await res.json()
      setItems(d.notifications ?? [])
      setUnread(d.unread ?? 0)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })))
    setUnread(0)
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
  }

  async function openItem(n: Notification) {
    setOpen(false)
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1))
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {})
    }
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        aria-label="შეტყობინებები"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-100">შეტყობინებები</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
              >
                <CheckCheck size={13} /> ყველა წაკითხულად
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                ჯერ არაფერია
              </div>
            ) : (
              items.map((n) => {
                const { Icon, cls } = ICONS[n.type] ?? ICONS.message
                return (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`flex w-full items-start gap-2.5 border-b border-slate-800/60 px-4 py-3 text-left transition-colors hover:bg-slate-700/50 ${
                      n.read ? '' : 'bg-slate-700/30'
                    }`}
                  >
                    <Icon size={16} className={`mt-0.5 flex-none ${cls}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-100">
                          {n.title}
                        </span>
                        <span className="flex-none text-[10px] text-slate-500">{timeAgo(n.created_at)}</span>
                      </div>
                      {n.body && <div className="truncate text-[11px] text-slate-400">{n.body}</div>}
                    </div>
                    {!n.read && <span className="mt-1 h-2 w-2 flex-none rounded-full bg-emerald-500" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
