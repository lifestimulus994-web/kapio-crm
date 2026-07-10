'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Plus, ArrowUpDown } from 'lucide-react'

export type TableCell = {
  /** Plain text shown in the cell. */
  value: string
  /** If set, the cell renders as a link (e.g. website, mailto). */
  href?: string
  /** Open link in a new tab (external sites). */
  external?: boolean
}

export type TableRow = {
  id: string
  href: string
  /** Initials shown in the avatar. */
  avatar: string
  title: string
  subtitle?: string
  /** Extra columns, in the same order as `columns`. */
  cells: TableCell[]
  /** Lowercased text used for client-side search. */
  searchText: string
}

type Tab = { label: string; href: string; active?: boolean }

export default function RecordsTable({
  rows,
  columns,
  tabs,
  createHref,
  createLabel,
  searchPlaceholder = 'Search…',
  avatarVariant = 'org',
  emptyText = 'Nothing here yet.',
}: {
  rows: TableRow[]
  columns: string[]
  tabs: Tab[]
  createHref: string
  createLabel: string
  searchPlaceholder?: string
  avatarVariant?: 'org' | 'contact'
  emptyText?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  // sortIndex: -1 = Name column, 0..n = extra columns
  const [sortIndex, setSortIndex] = useState(-1)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? rows.filter((r) => r.searchText.includes(q)) : rows.slice()
    base.sort((a, b) => {
      const av = sortIndex === -1 ? a.title : (a.cells[sortIndex]?.value ?? '')
      const bv = sortIndex === -1 ? b.title : (b.cells[sortIndex]?.value ?? '')
      const cmp = av.localeCompare(bv, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return base
  }, [rows, query, sortIndex, sortDir])

  function toggleSort(index: number) {
    if (sortIndex === index) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortIndex(index)
      setSortDir('asc')
    }
  }

  const avatarClass =
    avatarVariant === 'org'
      ? 'rounded-lg bg-emerald-900/40 text-emerald-400'
      : 'rounded-full bg-slate-700 text-slate-300'

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="px-6 pt-5 shrink-0">
        <div className="flex items-center gap-6 border-b border-slate-800">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`relative -mb-px pb-3 text-sm font-medium transition-colors ${
                t.active
                  ? 'text-emerald-400 border-b-2 border-emerald-500'
                  : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-4 flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-slate-800/70 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <span className="text-xs text-slate-500 hidden sm:inline">
          {filtered.length} of {rows.length}
        </span>
        <Link
          href={createHref}
          className="ml-auto inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          {createLabel}
        </Link>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left">
                <SortableHeader
                  label="Name"
                  active={sortIndex === -1}
                  dir={sortDir}
                  onClick={() => toggleSort(-1)}
                  className="pl-4"
                />
                {columns.map((c, i) => (
                  <SortableHeader
                    key={c}
                    label={c}
                    active={sortIndex === i}
                    dir={sortDir}
                    onClick={() => toggleSort(i)}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(row.href)}
                  className="group cursor-pointer hover:bg-slate-800/40 transition-colors"
                >
                  {/* Name */}
                  <td className="py-3 pl-4 pr-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 flex items-center justify-center text-sm font-semibold flex-none ${avatarClass}`}
                      >
                        {row.avatar}
                      </div>
                      <div className="min-w-0">
                        <p className="text-slate-100 font-medium truncate group-hover:text-emerald-400 transition-colors">
                          {row.title}
                        </p>
                        {row.subtitle && (
                          <p className="text-xs text-slate-500 truncate">
                            {row.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Extra columns */}
                  {row.cells.map((cell, i) => (
                    <td key={i} className="py-3 pr-4 text-slate-300">
                      {cell.value ? (
                        cell.href ? (
                          <a
                            href={cell.href}
                            onClick={(e) => e.stopPropagation()}
                            target={cell.external ? '_blank' : undefined}
                            rel={
                              cell.external ? 'noopener noreferrer' : undefined
                            }
                            className="text-slate-300 hover:text-emerald-400 transition-colors truncate inline-block max-w-[220px] align-bottom"
                          >
                            {cell.value}
                          </a>
                        ) : (
                          <span className="truncate inline-block max-w-[220px] align-bottom">
                            {cell.value}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="text-sm text-slate-600 text-center py-16">
              {query ? 'No matches found.' : emptyText}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  className = '',
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  className?: string
}) {
  return (
    <th
      className={`py-2.5 pr-4 font-medium ${className}`}
    >
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-xs uppercase tracking-wide transition-colors ${
          active ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        {label}
        <ArrowUpDown
          size={12}
          className={active ? 'opacity-100' : 'opacity-40'}
        />
        {active && <span className="sr-only">{dir}</span>}
      </button>
    </th>
  )
}
