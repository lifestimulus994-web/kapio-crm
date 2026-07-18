'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Mic, Loader2, Sparkles } from 'lucide-react'

type PendingConfirmation = {
  name: string
  args: Record<string, unknown>
  description: string
}
type Message = {
  role: 'user' | 'model'
  text: string
  confirmation?: PendingConfirmation
  resolved?: 'confirmed' | 'cancelled'
}

const suggestions = [
  'რომელი გარიგებებია მოლაპარაკების ეტაპზე?',
  'რა არის მთლიანი აქტიური პაიფლაინის ღირებულება?',
  'რომელი დავალებებია ვადაგადაცილებული?',
  'მომიძებნე 10 პოტენციური კლიენტი ჩემი სფეროდან თბილისში',
]

// Shared chat core used by BOTH the floating corner widget (AIAssistant) and
// the full-screen /ai page. It fills whatever container it is rendered into;
// the 'page' variant just gets roomier type and layout.
export default function AIChat({ variant }: { variant: 'widget' | 'page' }) {
  const page = variant === 'page'
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false) // actively recording
  const [transcribing, setTranscribing] = useState(false) // sending to Gemini
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const router = useRouter()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, loading])

  // Voice needs mic capture + recording support. Stop any recording on unmount.
  useEffect(() => {
    // One-time capability detect; must run on the client (window/navigator),
    // so it stays false during SSR to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceSupported(
      typeof window !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window.MediaRecorder !== 'undefined'
    )
    return () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Record the mic, then transcribe with Gemini (handles Georgian well, unlike
  // the browser's built-in speech recognition).
  async function toggleVoice() {
    if (transcribing) return

    // Stop an in-progress recording -> triggers onstop, which transcribes.
    if (listening) {
      recorderRef.current?.stop()
      return
    }

    setVoiceError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setVoiceError('მიკროფონზე წვდომა დაბლოკილია. დაუშვი ბრაუზერის პარამეტრებში.')
      return
    }

    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      setListening(false)
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      })
      if (blob.size === 0) return
      setTranscribing(true)
      try {
        const form = new FormData()
        form.append('audio', blob, 'note.webm')
        const res = await fetch('/api/transcribe', { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok) {
          setVoiceError(data.error ?? 'აუდიოს გაშიფვრა ვერ მოხერხდა.')
        } else if (data.text) {
          // Append to whatever is already typed.
          setInput((prev) => (prev ? `${prev} ${data.text}` : data.text))
        }
      } catch {
        setVoiceError('ქსელის შეცდომა გაშიფვრისას.')
      } finally {
        setTranscribing(false)
      }
    }

    recorderRef.current = recorder
    setListening(true)
    recorder.start()
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || loading) return
    const history = messages
    setMessages((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      })
      const data = await res.json()
      const reply = res.ok
        ? data.reply
        : `⚠️ ${data.error ?? 'რაღაც შეცდომა მოხდა.'}`
      setMessages((m) => [
        ...m,
        {
          role: 'model',
          text: reply,
          confirmation: res.ok ? data.pendingConfirmation : undefined,
        },
      ])
      // If the AI created/changed records, refresh the current page's data.
      if (res.ok && Array.isArray(data.actions) && data.actions.length > 0) {
        router.refresh()
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'model', text: '⚠️ ქსელის შეცდომა. სერვერი მუშაობს?' },
      ])
    } finally {
      setLoading(false)
    }
  }

  // Run (or dismiss) a destructive action the model held for review instead of
  // executing outright — archive_* tools always land here first.
  async function resolveConfirmation(index: number, confirmed: boolean) {
    const msg = messages[index]
    if (!msg.confirmation) return

    if (!confirmed) {
      setMessages((m) =>
        m.map((x, i) => (i === index ? { ...x, resolved: 'cancelled' } : x))
      )
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: { name: msg.confirmation.name, args: msg.confirmation.args },
        }),
      })
      const data = await res.json()
      setMessages((m) => [
        ...m.map((x, i) => (i === index ? { ...x, resolved: 'confirmed' as const } : x)),
        {
          role: 'model',
          text: res.ok ? data.reply : `⚠️ ${data.error ?? 'რაღაც შეცდომა მოხდა.'}`,
        },
      ])
      if (res.ok) router.refresh()
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'model', text: '⚠️ ქსელის შეცდომა. სერვერი მუშაობს?' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div
        ref={scrollRef}
        className={`flex-1 space-y-3 overflow-y-auto ${
          page ? 'px-4 py-6' : 'px-4 py-4'
        }`}
      >
        <div className={page ? 'mx-auto w-full max-w-3xl space-y-3' : ''}>
          {messages.length === 0 && (
            <div className={page ? 'space-y-5 pt-10 text-center' : 'space-y-3'}>
              {page && (
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-900/40 text-emerald-400">
                  <Sparkles size={24} />
                </div>
              )}
              <p className={`text-slate-400 ${page ? 'text-base' : 'text-sm'}`}>
                მკითხე ნებისმიერი რამ შენი CRM-ის შესახებ — გარიგებები, კონტაქტები,
                კომპანიები, დავალებები, ან მოაძებნინე ახალი ლიდები.
              </p>
              <div
                className={
                  page
                    ? 'mx-auto grid max-w-xl gap-2 sm:grid-cols-2'
                    : 'space-y-1.5'
                }
              >
                {(page ? suggestions : suggestions.slice(0, 3)).map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className={`block w-full rounded-lg border border-slate-700/70 bg-slate-800/40 text-left text-slate-300 hover:border-slate-600 hover:bg-slate-800 transition-colors ${
                      page ? 'px-3.5 py-2.5 text-sm' : 'px-3 py-2 text-xs'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`whitespace-pre-wrap rounded-2xl leading-relaxed ${
                  page
                    ? 'max-w-[80%] px-4 py-2.5 text-[15px]'
                    : 'max-w-[85%] px-3.5 py-2 text-sm'
                } ${
                  m.role === 'user'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-200'
                }`}
              >
                {m.text}
              </div>
              {m.confirmation && !m.resolved && (
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-amber-700/50 bg-amber-950/30 px-3 py-2">
                  <span className="text-xs text-amber-300">
                    {m.confirmation.description}
                  </span>
                  <button
                    onClick={() => resolveConfirmation(i, true)}
                    disabled={loading}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                  >
                    დადასტურება
                  </button>
                  <button
                    onClick={() => resolveConfirmation(i, false)}
                    disabled={loading}
                    className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-600 disabled:opacity-40"
                  >
                    გაუქმება
                  </button>
                </div>
              )}
              {m.confirmation && m.resolved === 'cancelled' && (
                <span className="mt-1 text-[11px] text-slate-500">გაუქმებულია.</span>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex gap-1 rounded-2xl bg-slate-800 px-4 py-3">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Voice error */}
      {voiceError && (
        <p className="mx-3 mb-1 rounded-lg bg-red-900/30 px-3 py-1.5 text-xs text-red-400">
          ⚠️ {voiceError}
        </p>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className={`border-t border-slate-800 ${page ? 'p-4' : 'p-3'}`}
      >
        <div
          className={`flex items-center gap-2 ${page ? 'mx-auto w-full max-w-3xl' : ''}`}
        >
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={transcribing}
              title={
                transcribing
                  ? 'გაშიფვრა…'
                  : listening
                    ? 'შეჩერება და გაშიფვრა'
                    : 'ხმის ჩაწერა'
              }
              className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-colors disabled:opacity-60 ${
                listening
                  ? 'bg-red-600 text-white animate-pulse hover:bg-red-500'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {transcribing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} />
              )}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              listening
                ? 'ჩაწერა… დააჭირე მიკროფონს შესაჩერებლად'
                : transcribing
                  ? 'გაშიფვრა…'
                  : 'იკითხე შენი CRM-ის შესახებ…'
            }
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  )
}
