import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { verifySignature, fetchLeadFields, fetchUserName, sendMessage } from '@/lib/meta'
import { generateDecision, type BookingContext } from '@/lib/inbox-ai'
import { scoreDelta } from '@/lib/lead-score'
import {
  getAvailableSlots,
  isSlotFree,
  createBooking,
  slotLabel,
  slotsOfferMessage,
  type BookingConfig,
} from '@/lib/booking'
import { notifyWorkspace } from '@/lib/notify'

export const dynamic = 'force-dynamic'
// Meta expects a fast 200; heavy work (Graph fetches) is kept minimal. A tenant
// may have several events batched in one POST, so give it headroom.
export const maxDuration = 30

// ---------------------------------------------------------------------------
// Single Meta webhook endpoint for the whole app. ONE Meta app receives events
// for every connected Page across all workspaces; we route each event to the
// right tenant by looking up entry[].id (the Page id) in channel_connections.
//
//   GET  -> subscription verification handshake (echo hub.challenge)
//   POST -> inbound events: Messenger messages + Lead Ads submissions
// ---------------------------------------------------------------------------

// --- GET: verification handshake -------------------------------------------
// Meta calls this once when you save the Callback URL. We echo hub.challenge
// only if hub.verify_token matches our secret.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// --- POST: inbound events ---------------------------------------------------
export async function POST(req: Request) {
  const raw = await req.text()

  // Reject anything not signed with our app secret.
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Bad signature', { status: 401 })
  }

  let body: MetaWebhookBody
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad JSON', { status: 400 })
  }

  // Always ack fast; process each entry, swallowing per-entry errors so one bad
  // event can't make Meta retry the whole batch forever.
  for (const entry of body.entry ?? []) {
    try {
      const conn = await connectionForPage(entry.id)
      if (!conn) continue // Page not connected to any workspace — ignore.

      // Messenger messages arrive under entry.messaging[].
      for (const ev of entry.messaging ?? []) {
        await handleMessaging(conn, ev)
      }
      // Lead Ads submissions arrive under entry.changes[] with field 'leadgen'.
      for (const ch of entry.changes ?? []) {
        if (ch.field === 'leadgen' && ch.value?.leadgen_id) {
          await handleLeadgen(conn, ch.value)
        }
      }
    } catch (err) {
      console.error('[meta webhook] entry failed', entry.id, err)
    }
  }

  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------

type Connection = {
  id: string
  workspace_id: string
  platform: string
  page_id: string
  access_token: string
}

async function connectionForPage(pageId: string): Promise<Connection | null> {
  const { data } = await supabase
    .from('channel_connections')
    .select('id, workspace_id, platform, page_id, access_token')
    .eq('page_id', pageId)
    .eq('status', 'active')
    .maybeSingle()
  return (data as Connection) ?? null
}

// --- Messenger -------------------------------------------------------------
async function handleMessaging(conn: Connection, ev: MessagingEvent) {
  // Echoes (our own outgoing) and non-message events are skipped.
  if (ev.message?.is_echo) return
  const psid = ev.sender?.id
  if (!psid) return

  const text = ev.message?.text ?? null
  const mid = ev.message?.mid ?? null

  // Ad attribution: a click-to-Messenger thread carries a referral (either at
  // the top level for the first tap, or inside the first message).
  const referral = ev.referral ?? ev.postback?.referral ?? ev.message?.referral
  const fromAd = Boolean(referral?.ad_id || referral?.ref)
  const source = fromAd ? 'fb_ad' : conn.platform === 'instagram' ? 'ig' : 'fb_organic'

  const convo = await upsertConversation(conn, psid, {
    source,
    adId: referral?.ad_id ?? null,
    ref: referral?.ref ?? null,
    preview: text,
  })

  if (mid || text) {
    await supabase.from('messages').insert({
      conversation_id: convo.id,
      workspace_id: conn.workspace_id,
      direction: 'in',
      body: text,
      external_id: mid,
    })
  }

  // Auto-reply (if enabled), then notify the team once — as "needs a human"
  // when the AI handed off, otherwise as a plain new message. If the AI
  // answered it fully, there's nothing for a human to do, so stay quiet.
  const preview = text?.slice(0, 120) ?? null
  const who = convo.name ?? 'ვინმემ'
  if (text) {
    const outcome = await maybeAutoReply(conn, convo.id, psid)
    if (outcome === 'handoff') {
      await notifyWorkspace({
        workspaceId: conn.workspace_id,
        type: 'handoff',
        title: 'AI-მ გადმოამისამართა',
        body: `${who}: ${preview ?? ''}`,
        link: '/inbox',
      })
    } else if (outcome === 'off') {
      await notifyWorkspace({
        workspaceId: conn.workspace_id,
        type: 'message',
        title: 'ახალი მესიჯი',
        body: `${who}: ${preview ?? ''}`,
        link: '/inbox',
      })
    }
  }
}

type AutoOutcome = 'handled' | 'handoff' | 'off'

// --- AI auto-reply ---------------------------------------------------------
// Answers an inbound message on the business's behalf when enabled. Sends only
// if the AI is confident from the workspace knowledge; otherwise flags the
// thread for a human instead of guessing.
async function maybeAutoReply(
  conn: Connection,
  convoId: string,
  psid: string
): Promise<AutoOutcome> {
  const { data: settings } = await supabase
    .from('inbox_settings')
    .select(
      'ai_enabled, knowledge, tone, booking_enabled, consult_minutes, work_days, work_start, work_end, buffer_minutes, min_notice_hours'
    )
    .eq('workspace_id', conn.workspace_id)
    .maybeSingle()
  if (!settings?.ai_enabled) return 'off'

  const { data: convo } = await supabase
    .from('conversations')
    .select(
      'ai_enabled, lead_score, consultation_offers, booking_stage, booking_name, booking_phone, proposed_slots, chosen_slot, booking_task_id, name'
    )
    .eq('id', convoId)
    .maybeSingle()
  if (!convo?.ai_enabled) return 'off' // a human has taken this thread over

  // The MOST RECENT 20 messages, in chronological order. (Ordering ascending
  // with a limit returns the OLDEST 20 — which froze the transcript on the
  // early greetings once a thread passed 20 messages, so the AI never saw new
  // questions and kept replying "გამარჯობა".)
  const { data: recent } = await supabase
    .from('messages')
    .select('direction, body, created_at')
    .eq('conversation_id', convoId)
    .order('created_at', { ascending: false })
    .limit(20)
  const msgs = (recent ?? []).reverse()
  const transcript = msgs
    .filter((m) => m.body)
    .map((m) => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.body}`)
    .join('\n')
  const alreadyGreeted = msgs.some((m) => m.direction === 'out')

  const proposedLabels = Array.isArray(convo.proposed_slots)
    ? (convo.proposed_slots as string[]).map((s) => slotLabel(s))
    : []
  const bookingCtx: BookingContext = {
    enabled: !!settings.booking_enabled,
    stage: convo.booking_stage ?? 'none',
    knownName: convo.booking_name ?? null,
    knownPhone: convo.booking_phone ?? null,
    proposedSlots: proposedLabels,
  }

  const decision = await generateDecision(
    settings.knowledge,
    settings.tone ?? '',
    transcript,
    alreadyGreeted,
    convo.consultation_offers ?? 0,
    bookingCtx
  )

  // Deterministic lead score from the signals the AI extracted (not its guess).
  const clamp = (n: number) => Math.max(-1000, Math.min(1000, n))
  const now = new Date().toISOString()
  const baseUpdate: Record<string, unknown> = {
    lead_score: clamp((convo.lead_score ?? 0) + scoreDelta(decision.signals)),
    intent: decision.intent,
    interest_level: decision.interest_level,
    consultation_offers: (convo.consultation_offers ?? 0) + (decision.offered_consultation ? 1 : 0),
    last_message_at: now,
  }
  if (decision.opt_out) {
    baseUpdate.opted_out = true
    baseUpdate.ai_enabled = false // stop the bot for someone who opted out
  }

  const send = async (text: string): Promise<boolean> => {
    try {
      await sendMessage(psid, text, conn.access_token)
      await supabase.from('messages').insert({
        conversation_id: convoId,
        workspace_id: conn.workspace_id,
        direction: 'out',
        body: text,
      })
      return true
    } catch (e) {
      console.error('[auto-reply] send failed', e)
      return false
    }
  }

  // ---- Booking state machine (deterministic times; overrides the reply) ----
  if (settings.booking_enabled && !decision.opt_out) {
    const booking = await runBooking(conn, convo, decision, settings)
    if (booking) {
      const ok = await send(booking.text)
      await supabase
        .from('conversations')
        .update({
          ...baseUpdate,
          ...booking.convoUpdate,
          last_message_preview: booking.text.slice(0, 200),
          unread: booking.needsHuman ? true : !ok,
          needs_human: booking.needsHuman || !ok,
        })
        .eq('id', convoId)
      return ok ? booking.outcome : 'handoff'
    }
  }

  // ---- Normal path ----
  if (decision.handoff) {
    await send(decision.reply)
    await supabase
      .from('conversations')
      .update({ ...baseUpdate, last_message_preview: decision.reply.slice(0, 200), needs_human: true, unread: true })
      .eq('id', convoId)
    return 'handoff'
  }

  const ok = await send(decision.reply)
  if (!ok) {
    await supabase
      .from('conversations')
      .update({ ...baseUpdate, last_message_preview: decision.reply.slice(0, 200), needs_human: true, unread: true })
      .eq('id', convoId)
    return 'handoff'
  }
  await supabase
    .from('conversations')
    .update({ ...baseUpdate, last_message_preview: decision.reply.slice(0, 200), unread: false, needs_human: false })
    .eq('id', convoId)
  return 'handled'
}

// --- Booking state machine --------------------------------------------------
// Returns a deterministic booking reply + conversation updates, or null when
// booking isn't the active concern this turn (fall through to the AI reply).
type BookingConvo = {
  booking_stage: string | null
  booking_name: string | null
  booking_phone: string | null
  proposed_slots: unknown
  chosen_slot: string | null
  booking_task_id: string | null
  name: string | null
}
type BookingResult = {
  text: string
  convoUpdate: Record<string, unknown>
  outcome: AutoOutcome
  needsHuman?: boolean
}
type BookingSettings = {
  consult_minutes: number
  work_days: string
  work_start: string
  work_end: string
  buffer_minutes: number
  min_notice_hours: number
}

async function runBooking(
  conn: Connection,
  convo: BookingConvo,
  decision: Awaited<ReturnType<typeof generateDecision>>,
  settings: BookingSettings
): Promise<BookingResult | null> {
  const b = decision.booking
  const stage = convo.booking_stage ?? 'none'
  const cfg: BookingConfig = {
    consultMinutes: settings.consult_minutes ?? 30,
    workDays: new Set(
      (settings.work_days ?? '1,2,3,4,5').split(',').map(Number).filter((n) => n >= 1 && n <= 7)
    ),
    workStart: settings.work_start ?? '10:00',
    workEnd: settings.work_end ?? '19:00',
    bufferMinutes: settings.buffer_minutes ?? 0,
    minNoticeHours: settings.min_notice_hours ?? 2,
  }
  const name = b.name || convo.booking_name || null
  const phone = b.phone || convo.booking_phone || null
  const slots = Array.isArray(convo.proposed_slots) ? (convo.proposed_slots as string[]) : []

  // Customer backed out of an active booking.
  if (b.cancel && (stage === 'proposed' || stage === 'awaiting_confirm')) {
    return {
      text: decision.reply,
      convoUpdate: { booking_stage: 'none', chosen_slot: null },
      outcome: 'handled',
    }
  }

  // Confirm -> create the appointment (idempotent + re-validate the slot).
  if (stage === 'awaiting_confirm' && b.confirmed && convo.chosen_slot) {
    if (convo.booking_task_id) {
      return { text: 'თქვენი ჯავშანი უკვე დადასტურებულია ✅', convoUpdate: {}, outcome: 'handled' }
    }
    const chosenIso = convo.chosen_slot
    const free = await isSlotFree(conn.workspace_id, chosenIso, cfg.consultMinutes)
    if (!free) {
      const fresh = await getAvailableSlots(conn.workspace_id, cfg, 4)
      if (!fresh.length) {
        return {
          text: 'ბოდიში, ეს დრო ამასობაში დაიკავეს და ახლა თავისუფალი დრო ვერ ვნახე. კოლეგა მალე დაგიკავშირდებათ 🙏',
          convoUpdate: { booking_stage: 'none', chosen_slot: null },
          outcome: 'handoff',
          needsHuman: true,
        }
      }
      return {
        text: `ბოდიში, ეს დრო ამასობაში დაიკავეს. ${slotsOfferMessage(fresh)}`,
        convoUpdate: { booking_stage: 'proposed', proposed_slots: fresh, chosen_slot: null },
        outcome: 'handled',
      }
    }
    const taskId = await createBooking({
      workspaceId: conn.workspace_id,
      assignedTo: null,
      name: name || convo.name || 'კლიენტი',
      phone,
      slotIso: chosenIso,
      consultMinutes: cfg.consultMinutes,
      source: 'Messenger',
    })
    if (!taskId) {
      return {
        text: 'ჯავშნისას ტექნიკური შეფერხება მოხდა. კოლეგა მალე დაგიკავშირდებათ 🙏',
        convoUpdate: {},
        outcome: 'handoff',
        needsHuman: true,
      }
    }
    return {
      text: `დაჯავშნილია ✅\n📅 ${slotLabel(chosenIso)} (თბილისის დროით)\n⏱ ${cfg.consultMinutes} წუთი\n\nმადლობა! შეხვედრამდე დაგიკავშირდებით.`,
      convoUpdate: {
        booking_stage: 'booked',
        booking_task_id: taskId,
        booking_name: name,
        booking_phone: phone,
      },
      outcome: 'handled',
    }
  }

  // Customer picked one of the offered slots -> ask to confirm.
  if (stage === 'proposed' && b.slot_choice && slots.length) {
    const chosen = slots[b.slot_choice - 1]
    if (chosen) {
      return {
        text: `ვადასტურებ: ${slotLabel(chosen)} (თბილისის დროით), ${cfg.consultMinutes} წუთი. დავჯავშნო? (კი / არა)`,
        convoUpdate: { booking_stage: 'awaiting_confirm', chosen_slot: chosen },
        outcome: 'handled',
      }
    }
    return null // unclear choice — let the AI ask again
  }

  // Start: customer wants a consultation.
  if ((stage === 'none' || stage === 'collecting') && b.wants_booking) {
    if (!name || !phone) {
      // Still missing name/phone — the AI's reply asks for it; remember what we have.
      return {
        text: decision.reply,
        convoUpdate: { booking_stage: 'collecting', booking_name: name, booking_phone: phone },
        outcome: 'handled',
      }
    }
    const fresh = await getAvailableSlots(conn.workspace_id, cfg, 4)
    if (!fresh.length) {
      return {
        text: 'ამ მომენტისთვის თავისუფალი დრო ვერ ვნახე — კოლეგა მალე დაგიკავშირდებათ ხელმისაწვდომ დროსთან დაკავშირებით 🙏',
        convoUpdate: { booking_stage: 'collecting', booking_name: name, booking_phone: phone },
        outcome: 'handoff',
        needsHuman: true,
      }
    }
    return {
      text: slotsOfferMessage(fresh),
      convoUpdate: {
        booking_stage: 'proposed',
        proposed_slots: fresh,
        booking_name: name,
        booking_phone: phone,
      },
      outcome: 'handled',
    }
  }

  return null // booking not active this turn
}

// --- Lead Ads --------------------------------------------------------------
async function handleLeadgen(conn: Connection, value: LeadgenValue) {
  const fields = await fetchLeadFields(value.leadgen_id, conn.access_token)
  const name =
    fields.full_name || fields.name ||
    [fields.first_name, fields.last_name].filter(Boolean).join(' ').trim() ||
    'უცნობი ლიდი'

  await supabase.from('leads').insert({
    workspace_id: conn.workspace_id,
    full_name: name,
    phone: fields.phone_number || fields.phone || null,
    email: fields.email || null,
    company: fields.company_name || null,
    source: 'FB Lead Ad',
    status: 'new',
    notes: value.ad_id ? `Ad: ${value.ad_id}` : null,
  })
}

// Find-or-create a conversation, refresh its last-message summary, and fetch
// the participant's name once (first time we see them).
async function upsertConversation(
  conn: Connection,
  externalId: string,
  opts: { source: string; adId: string | null; ref: string | null; preview: string | null }
) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, name')
    .eq('connection_id', conn.id)
    .eq('external_id', externalId)
    .maybeSingle()

  const now = new Date().toISOString()

  if (existing) {
    await supabase
      .from('conversations')
      .update({
        last_message_at: now,
        last_message_preview: opts.preview?.slice(0, 200) ?? null,
        unread: true,
      })
      .eq('id', existing.id)
    return existing as { id: string; name: string | null }
  }

  const name = await fetchUserName(externalId, conn.access_token)
  const { data: created } = await supabase
    .from('conversations')
    .insert({
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      platform: conn.platform,
      external_id: externalId,
      name,
      source: opts.source,
      ad_id: opts.adId,
      ref: opts.ref,
      last_message_at: now,
      last_message_preview: opts.preview?.slice(0, 200) ?? null,
      unread: true,
    })
    .select('id, name')
    .single()
  return created as { id: string; name: string | null }
}

// --- Meta webhook payload shapes (only the fields we read) -----------------
type MetaWebhookBody = { object?: string; entry?: MetaEntry[] }
type MetaEntry = {
  id: string
  messaging?: MessagingEvent[]
  changes?: { field: string; value: LeadgenValue }[]
}
type Referral = { ref?: string; ad_id?: string; source?: string; type?: string }
type MessagingEvent = {
  sender?: { id: string }
  recipient?: { id: string }
  message?: { mid?: string; text?: string; is_echo?: boolean; referral?: Referral }
  postback?: { referral?: Referral }
  referral?: Referral
}
type LeadgenValue = { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string }
