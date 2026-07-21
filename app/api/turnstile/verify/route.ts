import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Verify a Cloudflare Turnstile token server-side. Public (pre-auth). If no
// secret is configured, Turnstile isn't set up yet — pass so login/signup keep
// working until the keys are added.
export async function POST(req: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return NextResponse.json({ ok: true })

  let body: { token?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }
  if (!body.token) return NextResponse.json({ ok: false }, { status: 400 })

  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', body.token)

  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
    const d = (await r.json()) as { success?: boolean }
    return NextResponse.json({ ok: !!d.success })
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 })
  }
}
