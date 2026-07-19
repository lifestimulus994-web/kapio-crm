'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Send,
  Sparkles,
  UserPlus,
  Loader2,
  MessageSquare,
  Megaphone,
  Check,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Omnichannel inbox: conversation list (left) + thread (right). Inbound
// messages arrive via the Meta webhook and land in the DB; this UI polls for
// them every few seconds (no realtime socket yet). Replies go back out
// through the Page. AI drafts a suggested reply the human edits/sends.
// ---------------------------------------------------------------------------

type Conversation = {
  id: string
  name: string | null
  platform: string
  source: string | null
  ad_id: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread: boolean
  lead_id: string | null
}
type Message = { id: string; direction: 'in' | 'out'; body: string | null; created_at: string }

const POLL_MS = 5000

function sourceBadge(source: string | null) {
  if (source === 'fb_ad') return { label: 'რეკლამა', Icon: Megaphone, cls: 'text-amber-400' }
  if (source === 'ig') return { label: 'Instagram', Icon: MessageSquare, cls: 'text-pink-400' }
  return { label: 'Messenger', Icon: MessageSquare, cls: 'text-sky-400' }
}

function timeLabel(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ka-GE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

export default function Inbox() {
  const [convos, setConvos] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [converting, setConverting] = useState(false)
  const [leadId, setLeadId] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const activeConvo = convos.find((c) => c.id === activeId) ?? null

  // --- polling: conversation list -----------------------------------------
  const loadConvos = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setConvos(data.conversations ?? [])
    } catch {
      /* transient network — next tick retries */
    }
  }, [])

  useEffect(() => {
    loadConvos()
    const t = setInterval(loadConvos, POLL_MS)
    return () => clearInterval(t)
  }, [loadConvos])

  // --- polling: active thread ---------------------------------------------
  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/inbox/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages ?? [])
      setLeadId(data.conversation?.lead_id ?? null)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    loadThread(activeId)
    const t = setInterval(() => loadThread(activeId), POLL_MS)
    return () => clearInterval(t)
  }, [activeId, loadThread])

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  function openConvo(id: string) {
    setActiveId(id)
    setInput('')
    setMessages([])
    // Optimistically clear the unread dot in the list.
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)))
  }

  async function send() {
    const text = input.trim()
    if (!text || !activeId || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/inbox/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', text }),
      })
      if (res.ok) {
        setInput('')
        await loadThread(activeId)
        loadConvos()
      } else {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'პასუხი ვერ გაიგზავნა.')
      }
    } finally {
      setSending(false)
    }
  }

  async function aiDraft() {
    if (!activeId || drafting) return
    setDrafting(true)
    try {
      const res = await fetch(`/api/inbox/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft' }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.draft) setInput(d.draft)
      else alert(d.error ?? 'დრაფტი ვერ შეიქმნა.')
    } finally {
      setDrafting(false)
    }
  }

  async function convertToLead() {
    if (!activeId || converting || leadId) return
    setConverting(true)
    try {
      const res = await fetch(`/api/inbox/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lead' }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.lead_id) setLeadId(d.lead_id)
      else alert(d.error ?? 'ლიდი ვერ შეიქმნა.')
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Conversation list */}
      <div className="flex w-72 flex-none flex-col border-r border-slate-800">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">
          შემოსული
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {convos.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              ჯერ არცერთი საუბარი. როცა ვინმე Messenger-ში მოგწერს, აქ გამოჩნდება.
            </div>
          )}
          {convos.map((c) => {
            const b = sourceBadge(c.source)
            const active = c.id === activeId
            return (
              <button
                key={c.id}
                onClick={() => openConvo(c.id)}
                className={`flex w-full flex-col gap-0.5 border-b border-slate-800/60 px-4 py-3 text-left transition-colors ${
                  active ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {c.unread && <span className="h-2 w-2 flex-none rounded-full bg-emerald-500" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                    {c.name || 'უცნობი'}
                  </span>
                  <span className="flex-none text-[10px] text-slate-500">{timeLabel(c.last_message_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <b.Icon size={12} className={b.cls} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                    {c.last_message_preview || '—'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!activeConvo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            აირჩიე საუბარი მარცხნიდან
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-none items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-100">
                  {activeConvo.name || 'უცნობი'}
                </span>
                {(() => {
                  const b = sourceBadge(activeConvo.source)
                  return (
                    <span className={`flex items-center gap-1 text-[11px] ${b.cls}`}>
                      <b.Icon size={12} /> {b.label}
                    </span>
                  )
                })()}
              </div>
              {leadId ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <Check size={13} /> ლიდად დამატებულია
                </span>
              ) : (
                <button
                  onClick={convertToLead}
                  disabled={converting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
                >
                  {converting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  ლიდად გადაქცევა
                </button>
              )}
            </div>

            {/* Messages */}
            <div ref={threadRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      m.direction === 'out'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-100'
                    }`}
                  >
                    {m.body}
                    <div
                      className={`mt-0.5 text-[10px] ${
                        m.direction === 'out' ? 'text-emerald-100/70' : 'text-slate-500'
                      }`}
                    >
                      {timeLabel(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Composer */}
            <div className="flex-none border-t border-slate-800 p-3">
              <div className="flex items-end gap-2">
                <button
                  onClick={aiDraft}
                  disabled={drafting}
                  title="AI-ს პასუხის დაწერა"
                  className="flex-none rounded-lg border border-slate-700 bg-slate-800 p-2 text-emerald-400 transition-colors hover:bg-slate-700 disabled:opacity-50"
                >
                  {drafting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  rows={1}
                  placeholder="დაწერე პასუხი…"
                  className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-600 focus:outline-none"
                  style={{ fontFamily: 'var(--font-geist-sans), var(--font-firago), sans-serif', letterSpacing: 'normal' }}
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="flex-none rounded-lg bg-emerald-600 p-2 text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
