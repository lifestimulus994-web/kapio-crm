'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Send, X, Sparkles, Mic, Loader2 } from 'lucide-react'

type Message = { role: 'user' | 'model'; text: string }

const suggestions = [
  'What deals are in Negotiation?',
  'Total active pipeline value?',
  'Which tasks are overdue?',
]

export default function AIAssistant() {
  const [open, setOpen] = useState(false)
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
      setVoiceError('Microphone access was blocked. Allow it in your browser.')
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
          setVoiceError(data.error ?? 'Could not transcribe the audio.')
        } else if (data.text) {
          // Append to whatever is already typed.
          setInput((prev) => (prev ? `${prev} ${data.text}` : data.text))
        }
      } catch {
        setVoiceError('Network error while transcribing.')
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
        : `⚠️ ${data.error ?? 'Something went wrong.'}`
      setMessages((m) => [...m, { role: 'model', text: reply }])
      // If the AI created/changed records, refresh the current page's data.
      if (res.ok && Array.isArray(data.actions) && data.actions.length > 0) {
        router.refresh()
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'model', text: '⚠️ Network error. Is the server running?' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 shadow-lg shadow-emerald-900/40 transition-colors"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium">Ask AI</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
                <Bot size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  AI Assistant
                </p>
                <p className="text-[11px] text-slate-500">Powered by Gemini</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  Ask me anything about your CRM — deals, contacts, companies,
                  or tasks.
                </p>
                <div className="space-y-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="block w-full rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2 text-left text-xs text-slate-300 hover:border-slate-600 hover:bg-slate-800 transition-colors"
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
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  {m.text}
                </div>
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
            className="flex items-center gap-2 border-t border-slate-800 p-3"
          >
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={transcribing}
                title={
                  transcribing
                    ? 'Transcribing…'
                    : listening
                      ? 'Stop & transcribe'
                      : 'Record voice'
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
                  ? 'Recording… click mic to stop'
                  : transcribing
                    ? 'Transcribing…'
                    : 'Ask about your CRM…'
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
          </form>
        </div>
      )}
    </>
  )
}
