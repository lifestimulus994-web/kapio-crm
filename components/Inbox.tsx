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
  Camera,
  Plus,
  Link2,
  Bot,
  BotOff,
  AlertCircle,
  X,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Omnichannel inbox — three panes: conversation list | thread (centered,
// capped width) | contact/context panel. Inbound messages arrive via the Meta
// webhook and are polled here every few seconds. Replies go back through the
// Page; AI drafts a suggested reply the human edits before sending.
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
  needs_human: boolean
  ai_enabled: boolean
}
type Message = { id: string; direction: 'in' | 'out'; body: string | null; created_at: string }
type Channel = { id: string; platform: string; page_name: string | null }

const POLL_MS = 5000

function sourceBadge(source: string | null) {
  if (source === 'fb_ad') return { label: 'რეკლამიდან', Icon: Megaphone, cls: 'text-amber-400' }
  if (source === 'ig') return { label: 'Instagram', Icon: Camera, cls: 'text-pink-400' }
  return { label: 'Messenger', Icon: MessageSquare, cls: 'text-sky-400' }
}

function initials(name: string | null) {
  if (!name) return '?'
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

function timeLabel(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ka-GE', { hour: '2-digit', minute: '2-digit' })
}
function dateTimeLabel(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ka-GE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// A round initials avatar with a colour derived from the name (stable per person).
function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  const hues = ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600']
  let h = 0
  for (const c of name ?? '?') h = (h + c.charCodeAt(0)) % hues.length
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full font-semibold text-white ${hues[h]}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  )
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
  const [convoAi, setConvoAi] = useState<{
    ai_enabled: boolean
    needs_human: boolean
    lead_score: number
    interest_level: string | null
  }>({
    ai_enabled: true,
    needs_human: false,
    lead_score: 0,
    interest_level: null,
  })
  const [channels, setChannels] = useState<Channel[]>([])
  const [showConnect, setShowConnect] = useState(false)
  // Workspace AI auto-reply settings.
  const [showAi, setShowAi] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [knowledge, setKnowledge] = useState('')
  const [tone, setTone] = useState('')
  const [booking, setBooking] = useState({
    enabled: false,
    minutes: 30,
    days: '1,2,3,4,5',
    start: '10:00',
    end: '19:00',
  })
  const [savingAi, setSavingAi] = useState(false)
  const [savedAi, setSavedAi] = useState(false)
  // In-modal "test the AI" panel.
  const [testQ, setTestQ] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ reply: string; handoff: boolean } | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const activeConvo = convos.find((c) => c.id === activeId) ?? null

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

  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/channels', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setChannels(data.channels ?? [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const loadAiSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/settings', { cache: 'no-store' })
      if (!res.ok) return
      const d = await res.json()
      setAiEnabled(!!d.ai_enabled)
      setKnowledge(d.knowledge ?? '')
      setTone(d.tone ?? '')
      setBooking({
        enabled: !!d.booking_enabled,
        minutes: d.consult_minutes ?? 30,
        days: d.work_days ?? '1,2,3,4,5',
        start: d.work_start ?? '10:00',
        end: d.work_end ?? '19:00',
      })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadAiSettings()
  }, [loadAiSettings])

  async function saveAiSettings() {
    setSavingAi(true)
    setSavedAi(false)
    try {
      const res = await fetch('/api/inbox/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_enabled: aiEnabled,
          knowledge,
          tone,
          booking_enabled: booking.enabled,
          consult_minutes: booking.minutes,
          work_days: booking.days,
          work_start: booking.start,
          work_end: booking.end,
        }),
      })
      if (res.ok) {
        setSavedAi(true)
        setTimeout(() => setSavedAi(false), 2500)
      } else {
        alert('ვერ შeინახა.')
      }
    } finally {
      setSavingAi(false)
    }
  }

  const KNOWLEDGE_TEMPLATE = `## კომპანია
- სახელი:
- საქმიანობა:
- სამუშაო საათები:
- მისამართი / არეალი:

## სერვისები და ფასები
- სერვისი 1 — რა შედის, ფასი:
- სერვისი 2 — რა შედის, ფასი:

## ვადები
- სერვისი 1:
- სერვისი 2:

## ხშირი კითხვები
- კითხვა? — პასუხი.
- კითხვა? — პასუხი.

## რას არ ვამბობთ
- (დაუდასტურებელი გარანტია, არარსებული ფასდაკლება და ა.შ.)`

  async function runTest() {
    const q = testQ.trim()
    if (!q || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/inbox/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const d = await res.json()
      if (res.ok) setTestResult({ reply: d.reply, handoff: !!d.handoff })
      else alert(d.error ?? 'ტესტი ვერ შესრულდა.')
    } finally {
      setTesting(false)
    }
  }

  async function toggleConvoAi(enabled: boolean) {
    if (!activeId) return
    setConvoAi((s) => ({ ...s, ai_enabled: enabled, needs_human: enabled ? false : s.needs_human }))
    try {
      await fetch(`/api/inbox/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_ai', enabled }),
      })
    } catch {
      /* optimistic; next poll reconciles */
    }
  }

  // Show the result of an OAuth connect round-trip (?connect=ok|error|…).
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('connect')
    if (!p) return
    const map: Record<string, { ok: boolean; text: string }> = {
      ok: { ok: true, text: 'არხი დაკავშირდა ✅' },
      nopages: { ok: false, text: 'გვერდი ვერ მოიძებნა ამ ექაუნთზე.' },
      cancelled: { ok: false, text: 'დაკავშირება გაუქმდა.' },
      error: { ok: false, text: 'დაკავშირება ვერ მოხერხდა.' },
    }
    setConnectMsg(map[p] ?? null)
    loadChannels()
    // Clear the query param so a refresh doesn't re-show it.
    window.history.replaceState({}, '', '/inbox')
    const t = setTimeout(() => setConnectMsg(null), 5000)
    return () => clearTimeout(t)
  }, [loadChannels])

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/inbox/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages ?? [])
      setLeadId(data.conversation?.lead_id ?? null)
      setConvoAi({
        ai_enabled: data.conversation?.ai_enabled ?? true,
        needs_human: data.conversation?.needs_human ?? false,
        lead_score: data.conversation?.lead_score ?? 0,
        interest_level: data.conversation?.interest_level ?? null,
      })
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

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  function openConvo(id: string) {
    setActiveId(id)
    setInput('')
    setMessages([])
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

  const badge = activeConvo ? sourceBadge(activeConvo.source) : null

  return (
    <div className="relative flex h-full min-h-0">
      {connectMsg && (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            connectMsg.ok ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          {connectMsg.text}
        </div>
      )}
      {/* ---- Pane 1: conversation list ---- */}
      <div className="flex w-72 flex-none flex-col border-r border-slate-800">
        <div className="relative border-b border-slate-800 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">შემოსული</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setShowAi((s) => !s); setShowConnect(false) }}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                  aiEnabled
                    ? 'border-emerald-700 bg-emerald-900/40 text-emerald-400'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {aiEnabled ? <Bot size={12} /> : <BotOff size={12} />}
                ავტო-პასუხი
              </button>
              <button
                onClick={() => { setShowConnect((s) => !s); setShowAi(false) }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-700"
              >
                <Link2 size={12} />
                {channels.length > 0 ? `${channels.length} არხი` : 'დაკავშირება'}
              </button>
            </div>
          </div>

          {/* AI auto-reply settings — centered modal (a popover here would be
              clipped by the narrow list pane). */}
          {showAi && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setShowAi(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 p-5 shadow-2xl"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Bot size={16} className="text-emerald-400" /> ავტომატური პასუხი
                  </h2>
                  <button
                    onClick={() => setShowAi(false)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  >
                    <X size={18} />
                  </button>
                </div>

                <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5">
                  <span className="text-sm text-slate-200">AI ავტომატურად პასუხობს</span>
                  <button
                    type="button"
                    onClick={() => setAiEnabled((v) => !v)}
                    className={`relative h-6 w-11 flex-none rounded-full transition-colors ${aiEnabled ? 'bg-emerald-600' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${aiEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>

                <div className="mb-1.5 text-xs font-medium text-slate-300">
                  ტონი / პიროვნება
                </div>
                <p className="mb-2 text-[11px] leading-snug text-slate-500">
                  როგორ უნდა ილაპარაკოს AI-მ — ხასიათი, თბილობა, ემოჯი, კომპანიის სახელი.
                </p>
                <textarea
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={3}
                  placeholder="მაგ: თბილი, მეგობრული, პროფესიონალი. მიმართე „თქვენ“. ზომიერი ემოჯი. ყოველთვის დაასახელე Onyx Studio."
                  className="mb-4 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-600 focus:outline-none"
                  style={{ fontFamily: 'var(--font-geist-sans), var(--font-firago), sans-serif', letterSpacing: 'normal' }}
                />

                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">კომპანიის ინფორმაცია</span>
                  {!knowledge.trim() && (
                    <button
                      onClick={() => setKnowledge(KNOWLEDGE_TEMPLATE)}
                      className="text-[11px] text-emerald-400 transition-colors hover:text-emerald-300"
                    >
                      + შაბლონის ჩასმა
                    </button>
                  )}
                </div>
                <p className="mb-2 text-[11px] leading-snug text-slate-500">
                  AI მხოლოდ ამ ტექსტიდან პასუხობს. ჩაწერე ყველაფერი, რაც კლიენტს შეიძლება ჰკითხოს.
                </p>
                <textarea
                  value={knowledge}
                  onChange={(e) => setKnowledge(e.target.value)}
                  rows={6}
                  placeholder="მაგ:&#10;• სამუშაო საათები: ორშ-შაბ 10:00–20:00&#10;• მისამართი: თბილისი, ...&#10;• სერვისები და ფასები: ...&#10;• ხშირი კითხვები: ..."
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-600 focus:outline-none"
                  style={{ fontFamily: 'var(--font-geist-sans), var(--font-firago), sans-serif', letterSpacing: 'normal' }}
                />

                {/* Test the AI against the current knowledge */}
                <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                  <div className="mb-1.5 text-xs font-medium text-slate-300">AI-ს ტესტირება</div>
                  <p className="mb-2 text-[11px] leading-snug text-slate-500">
                    დაწერე კითხვა კლიენტივით და ნახე როგორ უპასუხებდა (რეალური გაგზავნის გარეშე).
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={testQ}
                      onChange={(e) => setTestQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          runTest()
                        }
                      }}
                      placeholder="მაგ: რა ღირს ვებსაიტი?"
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-600 focus:outline-none"
                      style={{ fontFamily: 'var(--font-geist-sans), var(--font-firago), sans-serif', letterSpacing: 'normal' }}
                    />
                    <button
                      onClick={runTest}
                      disabled={testing || !testQ.trim()}
                      className="flex-none rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {testing ? '...' : 'სცადე'}
                    </button>
                  </div>
                  {testResult && (
                    <div className="mt-2 rounded-lg bg-slate-800 p-2.5">
                      {testResult.handoff && (
                        <div className="mb-1 text-[10px] font-medium text-amber-400">
                          ⚠️ გადაამისამართებდა ადამიანთან (ეს პასუხი knowledge-ში არ არის)
                        </div>
                      )}
                      <div className="whitespace-pre-wrap text-xs text-slate-200">{testResult.reply}</div>
                    </div>
                  )}
                </div>

                {/* Booking */}
                <div className="mt-4 border-t border-slate-700 pt-4">
                  <label className="mb-3 flex cursor-pointer items-center justify-between">
                    <span className="text-sm text-slate-200">კონსულტაციის დაჯავშნა ჩატში</span>
                    <button
                      type="button"
                      onClick={() => setBooking((v) => ({ ...v, enabled: !v.enabled }))}
                      className={`relative h-6 w-11 flex-none rounded-full transition-colors ${booking.enabled ? 'bg-emerald-600' : 'bg-slate-600'}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${booking.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </label>

                  {booking.enabled && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <label className="flex-1 text-xs text-slate-400">
                          ხანგრძლივობა (წთ)
                          <input
                            type="number"
                            value={booking.minutes}
                            min={10}
                            step={5}
                            onChange={(e) => setBooking((v) => ({ ...v, minutes: Number(e.target.value) || 30 }))}
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                          />
                        </label>
                        <label className="flex-1 text-xs text-slate-400">
                          დაწყება
                          <input
                            type="time"
                            value={booking.start}
                            onChange={(e) => setBooking((v) => ({ ...v, start: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                          />
                        </label>
                        <label className="flex-1 text-xs text-slate-400">
                          დასრულება
                          <input
                            type="time"
                            value={booking.end}
                            onChange={(e) => setBooking((v) => ({ ...v, end: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                          />
                        </label>
                      </div>
                      <div>
                        <div className="mb-1.5 text-xs text-slate-400">სამუშაო დღეები</div>
                        <div className="flex gap-1">
                          {[
                            ['1', 'ორ'], ['2', 'სა'], ['3', 'ოთ'], ['4', 'ხუ'],
                            ['5', 'პა'], ['6', 'შა'], ['7', 'კვ'],
                          ].map(([num, label]) => {
                            const set = new Set(booking.days.split(',').filter(Boolean))
                            const on = set.has(num)
                            return (
                              <button
                                key={num}
                                type="button"
                                onClick={() => {
                                  const s = new Set(booking.days.split(',').filter(Boolean))
                                  if (s.has(num)) s.delete(num)
                                  else s.add(num)
                                  const ordered = ['1', '2', '3', '4', '5', '6', '7'].filter((d) => s.has(d))
                                  setBooking((v) => ({ ...v, days: ordered.join(',') }))
                                }}
                                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                                  on ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-700'
                                }`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <p className="text-[10px] leading-snug text-slate-500">
                        AI შესთავაზებს რეალურ თავისუფალ დროს (კალენდარი მინუს დაკავებული), დაჯავშნის → ჩანს /დავალებები კალენდარში.
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    {savedAi ? 'შენახულია ✅' : 'პასუხობს კლიენტის ენით. ვერ იცის → ადამიანს გადასცემს.'}
                  </span>
                  <button
                    onClick={saveAiSettings}
                    disabled={savingAi}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {savingAi ? '...' : 'შენახვა'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Connect popover */}
          {showConnect && (
            <div className="absolute right-4 top-full z-30 mt-1 w-60 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-xl">
              <div className="mb-2 text-xs font-semibold text-slate-200">დაკავშირებული არხები</div>
              {channels.length === 0 ? (
                <div className="mb-3 text-[11px] text-slate-500">ჯერ არცერთი. დააკავშირე გვერდი ქვემოთ.</div>
              ) : (
                <ul className="mb-3 space-y-1">
                  {channels.map((ch) => (
                    <li key={ch.id} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                      {ch.platform === 'instagram' ? (
                        <Camera size={12} className="text-pink-400" />
                      ) : (
                        <MessageSquare size={12} className="text-sky-400" />
                      )}
                      <span className="truncate">{ch.page_name || ch.platform}</span>
                    </li>
                  ))}
                </ul>
              )}
              <a
                href="/api/channels/facebook/start"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
              >
                <Plus size={13} /> Facebook / Instagram
              </a>
              <p className="mt-2 text-[10px] leading-snug text-slate-500">
                Facebook გვერდით შედი — გვერდები და მათი Instagram ავტომატურად დაუკავშირდება.
              </p>
            </div>
          )}
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
                className={`flex w-full items-center gap-3 border-b border-slate-800/60 px-3 py-3 text-left transition-colors ${
                  active ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                }`}
              >
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                      {c.name || 'უცნობი'}
                    </span>
                    <span className="flex-none text-[10px] text-slate-500">{timeLabel(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <b.Icon size={11} className={b.cls} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                      {c.last_message_preview || '—'}
                    </span>
                    {c.needs_human && <AlertCircle size={13} className="flex-none text-amber-400" />}
                    {c.unread && <span className="h-2 w-2 flex-none rounded-full bg-emerald-500" />}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Pane 2: thread ---- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-950/40">
        {!activeConvo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            აირჩიე საუბარი მარცხნიდან
          </div>
        ) : (
          <>
            <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-3">
                {messages.map((m) =>
                  m.direction === 'in' ? (
                    <div key={m.id} className="flex items-end gap-2">
                      <Avatar name={activeConvo.name} size={28} />
                      <div className="max-w-[80%]">
                        <div className="rounded-2xl rounded-bl-sm bg-slate-800 px-4 py-2.5 text-sm text-slate-100">
                          {m.body}
                        </div>
                        <div className="mt-1 pl-1 text-[10px] text-slate-500">{timeLabel(m.created_at)}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex flex-col items-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-sm text-white">
                        {m.body}
                      </div>
                      <div className="mt-1 pr-1 text-[10px] text-slate-500">{timeLabel(m.created_at)}</div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="flex-none border-t border-slate-800 px-4 py-3">
              <div className="mx-auto flex max-w-2xl items-end gap-2">
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

      {/* ---- Pane 3: contact / context ---- */}
      {activeConvo && badge && (
        <div className="hidden w-72 flex-none flex-col border-l border-slate-800 lg:flex">
          <div className="flex flex-col items-center gap-3 border-b border-slate-800 px-5 py-6 text-center">
            <Avatar name={activeConvo.name} size={64} />
            <div>
              <div className="text-base font-semibold text-slate-100">{activeConvo.name || 'უცნობი'}</div>
              <div className={`mt-1 flex items-center justify-center gap-1.5 text-xs ${badge.cls}`}>
                <badge.Icon size={13} /> {badge.label}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {/* Needs-human alert */}
            {convoAi.needs_human && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300">
                <AlertCircle size={14} className="mt-0.5 flex-none" />
                AI ვერ უპასუხა — საჭიროა შენი პასუხი.
              </div>
            )}

            {/* Per-conversation auto-reply */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase text-slate-500" style={{ letterSpacing: 'normal' }}>
                ავტო-პასუხი ამ საუბარზე
              </div>
              <button
                onClick={() => toggleConvoAi(!convoAi.ai_enabled)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors ${
                  convoAi.ai_enabled
                    ? 'border-emerald-800 bg-emerald-900/30 text-emerald-400'
                    : 'border-slate-700 bg-slate-800 text-slate-300'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {convoAi.ai_enabled ? <Bot size={14} /> : <BotOff size={14} />}
                  {convoAi.ai_enabled ? 'AI პასუხობს' : 'ხელით ვპასუხობ'}
                </span>
                <span className={`relative h-4 w-8 rounded-full ${convoAi.ai_enabled ? 'bg-emerald-600' : 'bg-slate-600'}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${convoAi.ai_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
            </div>

            {/* Lead status / action */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                ლიდი
              </div>
              {leadId ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-400">
                  <Check size={14} /> ლიდად დამატებულია
                </div>
              ) : (
                <button
                  onClick={convertToLead}
                  disabled={converting}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {converting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  ლიდად გადაქცევა
                </button>
              )}
            </div>

            {/* Lead score */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase text-slate-500" style={{ letterSpacing: 'normal' }}>
                <span>ინტერესის ქულა</span>
                <span
                  className={`text-sm font-bold ${
                    convoAi.lead_score >= 55
                      ? 'text-emerald-400'
                      : convoAi.lead_score >= 30
                        ? 'text-amber-400'
                        : 'text-slate-400'
                  }`}
                >
                  {convoAi.lead_score}
                </span>
              </div>
              {convoAi.interest_level && (
                <div className="text-[11px] text-slate-500">
                  ინტერესი:{' '}
                  {convoAi.interest_level === 'high'
                    ? 'მაღალი 🔥'
                    : convoAi.interest_level === 'medium'
                      ? 'საშუალო'
                      : 'სუსტი'}
                </div>
              )}
            </div>

            {/* Facts */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">არხი</span>
                <span className="text-slate-300">{badge.label}</span>
              </div>
              {activeConvo.ad_id && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">რეკლამა</span>
                  <span className="truncate text-slate-300">{activeConvo.ad_id}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">ბოლო შეტყობინება</span>
                <span className="text-slate-300">{dateTimeLabel(activeConvo.last_message_at)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
