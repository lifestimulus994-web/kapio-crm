'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, LogOut, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import NotificationBell from '@/components/NotificationBell'

// ---------------------------------------------------------------------------
// App top bar: global search (left), notification bell + profile menu (right).
// Sits above the page content; the sidebar keeps only navigation.
// ---------------------------------------------------------------------------

type Result = { type: string; label: string; sub: string | null; link: string }

function initials(email: string) {
  return email.slice(0, 2).toUpperCase()
}

export default function TopBar({ email }: { email: string }) {
  const router = useRouter()

  // --- global search -------------------------------------------------------
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [searching, setSearching] = useState(false)
  const [openSearch, setOpenSearch] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const runSearch = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
      const d = await res.json()
      setResults(d.results ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounce the query.
  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 250)
    return () => clearTimeout(t)
  }, [q, runSearch])

  // --- profile menu --------------------------------------------------------
  const [openProfile, setOpenProfile] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close popovers on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setOpenSearch(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setOpenProfile(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function goto(link: string) {
    setOpenSearch(false)
    setQ('')
    setResults([])
    router.push(link)
  }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="flex flex-none items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
      {/* Search */}
      <div ref={searchRef} className="relative max-w-md flex-1">
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
          <Search size={15} className="flex-none text-slate-500" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpenSearch(true)
            }}
            onFocus={() => setOpenSearch(true)}
            placeholder="ძებნა — კონტაქტი, ორგანიზაცია, ლიდი…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            style={{ fontFamily: 'var(--font-geist-sans), var(--font-firago), sans-serif', letterSpacing: 'normal' }}
          />
          {searching && <Loader2 size={14} className="flex-none animate-spin text-slate-500" />}
        </div>

        {openSearch && q.trim().length >= 2 && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                {searching ? 'ვეძებ…' : 'ვერაფერი მოიძებნა'}
              </div>
            ) : (
              results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => goto(r.link)}
                  className="flex w-full items-center gap-3 border-b border-slate-800/60 px-4 py-2.5 text-left transition-colors hover:bg-slate-700/50"
                >
                  <span className="flex-none rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {r.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-100">{r.label}</div>
                    {r.sub && <div className="truncate text-[11px] text-slate-500">{r.sub}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Notifications */}
      <NotificationBell />

      {/* Profile */}
      <div ref={profileRef} className="relative">
        <button
          onClick={() => setOpenProfile((o) => !o)}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-800"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
            {initials(email)}
          </span>
        </button>

        {openProfile && (
          <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="border-b border-slate-700 px-4 py-3">
              <div className="text-xs text-slate-500">შესული ხარ როგორც</div>
              <div className="truncate text-sm text-slate-100">{email}</div>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-300 transition-colors hover:bg-slate-700"
            >
              <LogOut size={15} /> გასვლა
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
