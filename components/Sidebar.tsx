'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { KanbanSquare, Building2, Users, ListTodo, UserCog, Menu, X } from 'lucide-react'
import VoiceImport from '@/components/VoiceImport'
import LogoutButton from '@/components/LogoutButton'

const nav = [
  { href: '/', label: 'Pipeline', Icon: KanbanSquare },
  { href: '/organizations', label: 'Organizations', Icon: Building2 },
  { href: '/contacts', label: 'Contacts', Icon: Users },
  { href: '/tasks', label: 'Tasks', Icon: ListTodo },
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
  const items = isOwner ? [...nav, { href: '/team', label: 'გუნდი', Icon: UserCog }] : nav

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

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map(({ href, label, Icon }) => {
            const active =
              href === '/' ? pathname === '/' : pathname.startsWith(href)
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
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-800 px-3 py-3">
          <LogoutButton />
          <div className="px-3 text-[11px] text-slate-600 truncate">{email}</div>
        </div>
      </aside>
    </>
  )
}
