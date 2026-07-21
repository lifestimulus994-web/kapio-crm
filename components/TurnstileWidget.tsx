'use client'

import { useEffect, useRef } from 'react'

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export function turnstileEnabled() {
  return !!SITE_KEY
}

// Renders the Cloudflare Turnstile widget and reports its token. No-op (renders
// nothing) until NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured, so the login/
// signup forms keep working before setup.
export default function TurnstileWidget({ onToken }: { onToken: (t: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const rendered = useRef(false)

  useEffect(() => {
    if (!SITE_KEY) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any

    const render = () => {
      if (rendered.current || !box.current || !w.turnstile) return
      rendered.current = true
      w.turnstile.render(box.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
    }

    if (w.turnstile) {
      render()
      return
    }
    const id = 'cf-turnstile-script'
    let s = document.getElementById(id) as HTMLScriptElement | null
    if (!s) {
      s = document.createElement('script')
      s.id = id
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }
    s.addEventListener('load', render)
    return () => s?.removeEventListener('load', render)
  }, [onToken])

  if (!SITE_KEY) return null
  return <div ref={box} className="flex justify-center" />
}
