import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'
import {
  exchangeWhatsAppCode,
  subscribeWabaToApp,
  fetchWhatsAppNumber,
  registerWhatsAppNumber,
} from '@/lib/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Finishes WhatsApp Embedded Signup. The frontend runs Meta's popup, then POSTs
// the resulting { code, phone_number_id, waba_id } here. We exchange the code
// for a business token, subscribe the WABA to our webhook, register the number,
// and store it as a channel_connection for this member's workspace.
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })

  let body: { code?: string; phone_number_id?: string; waba_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'არასწორი მოთხოვნა.' }, { status: 400 })
  }
  const { code, phone_number_id, waba_id } = body
  if (!code || !phone_number_id || !waba_id)
    return NextResponse.json({ error: 'არასრული მონაცემი.' }, { status: 400 })

  try {
    const token = await exchangeWhatsAppCode(code)
    await subscribeWabaToApp(waba_id, token)
    await registerWhatsAppNumber(phone_number_id, token)
    const name = await fetchWhatsAppNumber(phone_number_id, token)

    await supabase.from('channel_connections').upsert(
      {
        workspace_id: me.workspace_id,
        connected_by: me.id,
        platform: 'whatsapp',
        page_id: phone_number_id, // routing key for WhatsApp
        page_name: name || 'WhatsApp',
        access_token: token,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform,page_id' }
    )

    return NextResponse.json({ ok: true, name })
  } catch (e) {
    console.error('[whatsapp connect] failed', e)
    return NextResponse.json(
      { error: `დაკავშირება ვერ მოხერხდა: ${e instanceof Error ? e.message : 'უცნობი'}` },
      { status: 502 }
    )
  }
}
