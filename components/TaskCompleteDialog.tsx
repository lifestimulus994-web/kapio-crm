'use client'

import { useState } from 'react'
import { X, Sparkles, MessageSquare, Check, Loader2 } from 'lucide-react'
import type { Task } from '@/types'

export default function TaskCompleteDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task
  onClose: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState('')
  const [loading, setLoading] = useState<null | 'ai' | 'manual' | 'done'>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const hasOpp = !!task.opportunity

  async function submit(mode: 'ai' | 'manual' | 'done') {
    if (loading) return
    setLoading(mode)
    setError(null)
    try {
      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, outcome, mode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
      } else {
        setSummary(data.summary ?? 'Done.')
        // Give the user a beat to read the summary, then refresh.
        setTimeout(onDone, mode === 'ai' ? 900 : 250)
      }
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
              <Check size={16} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">
                Complete task
              </p>
              <p className="truncate text-[11px] text-slate-500">{task.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={!!loading}
            className="text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">
          {summary ? (
            <p className="rounded-lg bg-emerald-900/20 px-3 py-2.5 text-sm text-emerald-300">
              {summary}
            </p>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  How did it actually go?
                </label>
                <textarea
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder={
                    hasOpp
                      ? 'e.g. Client didn’t answer, asked to call back Friday…'
                      : 'Notes (this task isn’t linked to an opportunity)'
                  }
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                />
              </div>

              {hasOpp ? (
                <p className="text-[11px] text-slate-500">
                  Linked to opportunity{' '}
                  <span className="text-slate-400">{task.opportunity!.title}</span>.
                  AI will log a tidy comment there and add a follow-up if needed.
                </p>
              ) : (
                <p className="text-[11px] text-slate-500">
                  No opportunity linked — the task will just be marked done.
                </p>
              )}

              {error && (
                <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
                  ⚠️ {error}
                </p>
              )}

              {/* Actions */}
              <div className="space-y-2">
                {hasOpp && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => submit('ai')}
                      disabled={!!loading || !outcome.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                    >
                      {loading === 'ai' ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Sparkles size={15} />
                      )}
                      Log with AI
                    </button>
                    <button
                      onClick={() => submit('manual')}
                      disabled={!!loading || !outcome.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40"
                    >
                      {loading === 'manual' ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <MessageSquare size={15} />
                      )}
                      Save as comment
                    </button>
                  </div>
                )}
                <button
                  onClick={() => submit('done')}
                  disabled={!!loading}
                  className="w-full rounded-lg py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-40"
                >
                  {loading === 'done' ? 'Marking…' : 'Just mark done'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
