'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { KanbanSquare, Building2, Users, ListTodo, UserCog } from 'lucide-react'
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
  const items = isOwner ? [...nav, { href: '/team', label: 'გუნდი', Icon: UserCog }] : nav

  return (
    <aside className="flex h-screen w-56 flex-none flex-col border-r border-slate-800 bg-slate-900">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Image
          src="/logo.png"
          alt="Kapio"
          width={32}
          height={32}
          className="rounded-lg"
        />
        <span className="text-base font-semibold text-slate-100">Kapio CRM</span>
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
  )
}
