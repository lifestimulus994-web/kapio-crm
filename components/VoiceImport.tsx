'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Upload, Loader2, FileAudio, Sparkles, Trash2 } from 'lucide-react'

type ActionEntry = { name: string; result: Record<string, unknown> }
type PlanItem = { name: string; args: Record<string, unknown> }

const actionLabels: Record<string, string> = {
  create_organization: 'Organization',
  create_contact: 'Contact',
  create_opportunity: 'Opportunity',
  create_task: 'Task',
  update_opportunity: 'Update opportunity',
  update_task: 'Update task',
  add_task_comment: 'Task comment',
}

// Order to show fields in, and friendly labels. Anything not listed is shown
// after these, with its raw key humanized.
const fieldLabels: Record<string, string> = {
  name: 'Name',
  legal_name: 'Legal name',
  identification_code: 'ID / tax code',
  first_name: 'First name',
  last_name: 'Last name',
  job_title: 'Job title',
  title: 'Title',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  address: 'Address',
  industry: 'Industry',
  notes: 'Notes',
  value_gel: 'Value (GEL)',
  stage: 'Stage',
  pain_points: 'Pain points',
  next_action: 'Next action',
  description: 'Description',
  start_date: 'Start date',
  due_date: 'Due date',
  priority: 'Priority',
  owner: 'Owner',
  status: 'Status',
  organization_name: 'Company',
  contact_name: 'Contact',
  opportunity_title: 'Opportunity',
  task_title: 'Task',
  author: 'Author',
  body: 'Comment',
}

function humanize(key: string) {
  return fieldLabels[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export default function VoiceImport() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'pick' | 'review' | 'done'>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [actions, setActions] = useState<ActionEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function reset() {
    setStep('pick')
    setFile(null)
    setError(null)
    setSummary(null)
    setPlan([])
    setActions([])
    if (inputRef.current) inputRef.current.value = ''
  }

  function close() {
    if (loading) return
    setOpen(false)
    reset()
  }

  // Phase 1: transcribe + propose a plan (writes nothing).
  async function analyze() {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('audio', file)
      const res = await fetch('/api/voice', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
      } else {
        setSummary(data.summary ?? '')
        setPlan(Array.isArray(data.plan) ? data.plan : [])
        setStep('review')
      }
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  // Phase 2: save the reviewed/edited plan.
  async function confirm() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.')
      } else {
        setActions(Array.isArray(data.actions) ? data.actions : [])
        setStep('done')
        router.refresh()
      }
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  function updateField(index: number, key: string, value: string) {
    setPlan((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, args: { ...item.args, [key]: value } } : item
      )
    )
  }

  function removeItem(index: number) {
    setPlan((prev) => prev.filter((_, i) => i !== index))
  }

  function orderedEntries(args: Record<string, unknown>) {
    const keys = Object.keys(args)
    const known = Object.keys(fieldLabels).filter((k) => keys.includes(k))
    const rest = keys.filter((k) => !fieldLabels[k])
    return [...known, ...rest].map((k) => [k, args[k]] as const)
  }

  return (
    <>
      {/* Sidebar trigger */}
      <button
        onClick={() => setOpen(true)}
        className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:border-emerald-600/60 hover:text-emerald-400"
      >
        <Plus size={16} />
        Voice note
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    Voice note → CRM
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {step === 'review'
                      ? 'Review & fix before saving'
                      : step === 'done'
                        ? 'Saved to your CRM'
                        : 'Upload audio; AI proposes records'}
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                disabled={loading}
                className="text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 overflow-y-auto px-5 py-5">
              {/* Step 1: file picker */}
              {step === 'pick' && (
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
                    file
                      ? 'border-emerald-600/60 bg-emerald-900/10'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null)
                      setError(null)
                    }}
                  />
                  {file ? (
                    <>
                      <FileAudio size={22} className="text-emerald-400" />
                      <span className="text-sm text-slate-200">{file.name}</span>
                      <span className="text-xs text-slate-500">
                        {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload size={22} className="text-slate-500" />
                      <span className="text-sm text-slate-300">
                        Choose an audio file
                      </span>
                      <span className="text-xs text-slate-500">
                        mp3, m4a, ogg, wav · max 15 MB
                      </span>
                    </>
                  )}
                </label>
              )}

              {/* Step 2: review the proposed plan */}
              {step === 'review' && (
                <div className="space-y-4">
                  {summary && (
                    <div className="rounded-xl bg-slate-800/50 px-3.5 py-3">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        What the AI heard
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                        {summary}
                      </p>
                    </div>
                  )}

                  {plan.length === 0 ? (
                    <p className="rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-slate-400">
                      The AI did not propose any records. Try a clearer recording.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Check the details — fix any misheard names — then save.
                      </p>
                      {plan.map((item, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-slate-800 bg-slate-800/30 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-400">
                              {actionLabels[item.name] ?? item.name}
                            </span>
                            <button
                              onClick={() => removeItem(i)}
                              className="text-slate-500 transition-colors hover:text-red-400"
                              title="Remove this record"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          <div className="space-y-2">
                            {orderedEntries(item.args).map(([key, value]) => {
                              const isLong = key === 'notes' || key === 'description' || key === 'body' || key === 'pain_points'
                              return (
                                <div key={key}>
                                  <label className="mb-0.5 block text-[11px] text-slate-500">
                                    {humanize(key)}
                                  </label>
                                  {isLong ? (
                                    <textarea
                                      value={String(value ?? '')}
                                      onChange={(e) => updateField(i, key, e.target.value)}
                                      rows={2}
                                      className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-600/60"
                                    />
                                  ) : (
                                    <input
                                      value={String(value ?? '')}
                                      onChange={(e) => updateField(i, key, e.target.value)}
                                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-600/60"
                                    />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* Step 3: result */}
              {step === 'done' && (
                <div className="space-y-3">
                  {actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((a, i) => {
                        const ok = a.result?.success !== false
                        return (
                          <span
                            key={i}
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              ok
                                ? 'bg-emerald-900/40 text-emerald-400'
                                : 'bg-red-900/40 text-red-400'
                            }`}
                          >
                            {ok ? '✓' : '✕'} {actionLabels[a.name] ?? a.name}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <p className="rounded-lg bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300">
                    Saved to your CRM.
                  </p>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
                  ⚠️ {error}
                </p>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex gap-2.5 border-t border-slate-800 px-5 py-4">
              {step === 'pick' && (
                <button
                  onClick={analyze}
                  disabled={!file || loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    'Analyze'
                  )}
                </button>
              )}

              {step === 'review' && (
                <>
                  <button
                    onClick={reset}
                    disabled={loading}
                    className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirm}
                    disabled={loading || plan.length === 0}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Saving…
                      </>
                    ) : (
                      `Confirm & save${plan.length ? ` (${plan.length})` : ''}`
                    )}
                  </button>
                </>
              )}

              {step === 'done' && (
                <button
                  onClick={reset}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
                >
                  New recording
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
