'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Loader2 } from 'lucide-react'

// Self-serve WhatsApp connect via Meta's Embedded Signup. The customer clicks
// this, goes through Meta's popup, and their WhatsApp Business number is stored
// as a channel. Requires two build-time envs (set once you've configured
// WhatsApp Embedded Signup in the Meta app):
//   NEXT_PUBLIC_META_APP_ID
//   NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID
// If either is missing the button explains that setup is pending.

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID
const CONFIG_ID = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID
const GRAPH_VERSION = 'v21.0'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWin = any

export default function WhatsAppConnect({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false)
  const signup = useRef<{ phone_number_id?: string; waba_id?: string }>({})

  // Load the Facebook JS SDK once.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) return
    const w = window as AnyWin
    if (w.FB) return
    w.fbAsyncInit = () => {
      w.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION })
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true
    s.defer = true
    document.body.appendChild(s)
  }, [])

  // Meta posts the WABA + phone number id through a window message.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(e.origin).hostname)) return
      try {
        const data = JSON.parse(e.data)
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.data) {
          signup.current = {
            phone_number_id: data.data.phone_number_id,
            waba_id: data.data.waba_id,
          }
        }
      } catch {
        /* not our message */
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  async function finish(code: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/channels/whatsapp/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...signup.current }),
      })
      const d = await res.json()
      if (res.ok) {
        alert(`WhatsApp დაკავშირდა: ${d.name ?? ''} ✅`)
        onDone?.()
      } else {
        alert(d.error ?? 'დაკავშირება ვერ მოხერხდა.')
      }
    } finally {
      setBusy(false)
    }
  }

  function launch() {
    const w = window as AnyWin
    if (!w.FB) return
    w.FB.login(
      (resp: AnyWin) => {
        const code = resp?.authResponse?.code
        if (code) finish(code)
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '2' },
      }
    )
  }

  if (!APP_ID || !CONFIG_ID) {
    return (
      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] leading-snug text-slate-500">
        WhatsApp-ის თვითდაკავშირება ჯერ არ არის კონფიგურირებული (Meta Embedded Signup).
      </div>
    )
  }

  return (
    <button
      onClick={launch}
      disabled={busy}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
      WhatsApp-ის დაკავშირება
    </button>
  )
}
