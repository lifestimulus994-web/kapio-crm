'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { KanbanSquare, Building2, Users, ListTodo, UserCog, Target, Sparkles, Workflow, MessageSquare, Menu, X } from 'lucide-react'
import VoiceImport from '@/components/VoiceImport'
import LogoutButton from '@/components/LogoutButton'

type NavItem = { href: string; label: string; Icon: typeof Sparkles }
type NavGroup = { title?: string; items: NavItem[] }

// Grouped by workflow, all Georgian: a lead comes IN (გაყიდვები), becomes a
// record (ბაზა), then work happens around it (სამუშაო). AI sits on top as the
// primary entry point; owner-only management lives at the bottom.
const groups: NavGroup[] = [
  { items: [{ href: '/ai', label: 'AI ასისტენტი', Icon: Sparkles }] },
  {
    title: 'გაყიდვები',
    items: [
      { href: '/inbox', label: 'შემოსული', Icon: MessageSquare },
      { href: '/leads', label: 'ლიდები', Icon: Target },
      { href: '/dashboard', label: 'შესაძლებლობები', Icon: KanbanSquare },
    ],
  },
  {
    title: 'ბაზა',
    items: [
      { href: '/organizations', label: 'ორგანიზაციები', Icon: Building2 },
      { href: '/contacts', label: 'კონტაქტები', Icon: Users },
    ],
  },
  {
    title: 'სამუშაო',
    items: [
      { href: '/tasks', label: 'დავალებები', Icon: ListTodo },
      { href: '/boards', label: 'სტრატეგია', Icon: Workflow },
    ],
  },
]

export default function Sidebar({
  email,
  isOwner,
}: {
  email: string
  isOwner: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Badge on "შემოსული": how many conversations need attention (unread or
  // flagged for a human). Polled so it updates as messages arrive.
  const [inboxCount, setInboxCount] = useState(0)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/inbox/count', { cache: 'no-store' })
        if (!res.ok) return
        const d = await res.json()
        if (alive) setInboxCount(d.count ?? 0)
      } catch {
        /* ignore */
      }
    }
    load()
    const t = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [pathname])

  const renderGroups: NavGroup[] = isOwner
    ? [...groups, { title: 'მართვა', items: [{ href: '/team', label: 'გუნდი', Icon: UserCog }] }]
    : groups

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Kapio" width={28} height={28} className="rounded-lg" />
          <span className="text-sm font-semibold text-slate-100">Kapio CRM</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* Backdrop (mobile drawer open) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-none flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Kapio"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-base font-semibold text-slate-100">Kapio CRM</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Voice note → CRM */}
        <VoiceImport />

        {/* Nav — grouped by workflow */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {renderGroups.map((group, gi) => (
            <div key={group.title ?? `g${gi}`} className={gi === 0 ? '' : 'mt-4'}>
              {group.title && (
                <div
                  className="px-3 pb-1 text-[10px] font-semibold uppercase text-slate-600"
                  style={{ letterSpacing: 'normal' }}
                >
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map(({ href, label, Icon }) => {
                  const active = pathname.startsWith(href)
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-emerald-900/40 text-emerald-400'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <Icon size={18} />
                      <span className="flex-1">{label}</span>
                      {href === '/inbox' && inboxCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">
                          {inboxCount > 99 ? '99+' : inboxCount}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-800 px-3 py-3">
          <LogoutButton />
          <div className="px-3 text-[11px] text-slate-600 truncate">{email}</div>
        </div>
      </aside>
    </>
  )
}
