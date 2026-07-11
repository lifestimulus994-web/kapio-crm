'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPaste, X, Loader2 } from 'lucide-react'

type FieldKey = 'full_name' | 'phone' | 'email' | 'company' | 'source' | 'notes' | 'skip'

const FIELD_OPTIONS: { value: FieldKey; label: string }[] = [
  { value: 'full_name', label: 'Full Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'source', label: 'Source' },
  { value: 'notes', label: 'Notes' },
  { value: 'skip', label: '— Skip —' },
]

const PHONE_RE = /^[\d+()\-\s]{5,20}$/

// Best-effort guess per column: phone/email are detected from content, the
// rest fall in "name, company, notes" order since that's the typical layout
// of a hand-kept sales spreadsheet. The user can override any column.
function guessColumns(rows: string[][]): FieldKey[] {
  const colCount = Math.max(0, ...rows.map((r) => r.length))
  const guesses: FieldKey[] = new Array(colCount).fill('skip')

  for (let c = 0; c < colCount; c++) {
    const values = rows.map((r) => r[c]?.trim()).filter(Boolean)
    if (values.length === 0) continue
    if (values.every((v) => PHONE_RE.test(v) && /\d/.test(v))) {
      guesses[c] = 'phone'
    } else if (values.some((v) => v.includes('@'))) {
      guesses[c] = 'email'
    }
  }

  const positionalOrder: FieldKey[] = ['full_name', 'company', 'notes']
  let next = 0
  for (let c = 0; c < colCount; c++) {
    if (guesses[c] !== 'skip') continue
    const hasValues = rows.some((r) => r[c]?.trim())
    if (!hasValues) continue
    if (next < positionalOrder.length) {
      guesses[c] = positionalOrder[next]
      next++
    }
  }
  return guesses
}

function parsePaste(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
}

export default function PasteImport({
  isOwner,
  members,
}: {
  isOwner: boolean
  members: { id: string; full_name: string | null; email: string }[]
}) {
  const router = useRouter()
  const [raw, setRaw] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [columnMap, setColumnMap] = useState<FieldKey[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [assignedTo, setAssignedTo] = useState('')
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  function handleChange(value: string) {
    setRaw(value)
    setMessage(null)
    const parsed = parsePaste(value)
    setRows(parsed)
    setColumnMap(guessColumns(parsed))
    setExcluded(new Set())
  }

  const includedRows = useMemo(
    () => rows.filter((_, i) => !excluded.has(i)),
    [rows, excluded]
  )

  function updateColumn(index: number, field: FieldKey) {
    setColumnMap((m) => m.map((f, i) => (i === index ? field : f)))
  }

  function toggleRow(index: number) {
    setExcluded((s) => {
      const next = new Set(s)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleImport() {
    const hasNameColumn = columnMap.includes('full_name')
    if (!hasNameColumn) {
      setMessage({ type: 'error', text: 'აღნიშნე რომელი სვეტია Full Name.' })
      return
    }

    const payloadRows = rows
      .map((row, i) => {
        if (excluded.has(i)) return null
        const record: Record<string, string> = {}
        columnMap.forEach((field, c) => {
          if (field === 'skip') return
          const value = row[c]?.trim()
          if (!value) return
          record[field] = record[field] ? `${record[field]} ${value}` : value
        })
        return record.full_name ? record : null
      })
      .filter((r): r is Record<string, string> => r !== null)

    if (payloadRows.length === 0) {
      setMessage({ type: 'error', text: 'დასამატებელი ვალიდური ხაზი არ დარჩა.' })
      return
    }

    setImporting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payloadRows, assigned_to: assignedTo || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error ?? 'იმპორტი ვერ შესრულდა.' })
        return
      }
      setMessage({ type: 'success', text: `დაემატა ${data.imported} ლიდი.` })
      setRaw('')
      setRows([])
      setColumnMap([])
      setExcluded(new Set())
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'ქსელის შეცდომა.' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardPaste size={14} className="text-slate-500" />
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Paste multiple from Excel
        </h2>
      </div>

      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        placeholder="Excel-იდან დააკოპირე ხაზები (Ctrl+C) და ჩააკოპირე აქ (Ctrl+V) — ერთდროულად თუნდაც 100 ლიდი"
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 resize-none"
      />

      {rows.length > 0 && (
        <div className="space-y-3">
          {isOwner && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Assign all to
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full max-w-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-700/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/60">
                  <th className="w-8" />
                  {columnMap.map((field, c) => (
                    <th key={c} className="px-2 py-2 text-left">
                      <select
                        value={field}
                        onChange={(e) => updateColumn(c, e.target.value as FieldKey)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-md px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                      >
                        {FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rows.slice(0, 30).map((row, i) => (
                  <tr key={i} className={excluded.has(i) ? 'opacity-30' : ''}>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => toggleRow(i)}
                        title={excluded.has(i) ? 'Include row' : 'Exclude row'}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </td>
                    {columnMap.map((_, c) => (
                      <td key={c} className="px-2 py-1.5 text-slate-300 truncate max-w-[160px]">
                        {row[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > 30 && (
            <p className="text-xs text-slate-500">
              +{rows.length - 30} more row(s) not shown, will still be imported.
            </p>
          )}

          <p className="text-xs text-slate-500">
            {includedRows.length} of {rows.length} row(s) will be imported.
          </p>

          {message && (
            <p className={`text-xs ${message.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {message.text}
            </p>
          )}

          <button
            type="button"
            onClick={handleImport}
            disabled={importing || includedRows.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40"
          >
            {importing && <Loader2 size={14} className="animate-spin" />}
            Import {includedRows.length} lead{includedRows.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </section>
  )
}
