import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Thin wrappers around the Meta Graph API used by the omnichannel inbox
// (Facebook/Instagram Messenger + Lead Ads). Server-only: reads the app
// secret from the environment and Page tokens from channel_connections.
// ---------------------------------------------------------------------------

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

// Verify the X-Hub-Signature-256 header Meta attaches to every webhook POST.
// Guards the endpoint: only requests signed with OUR app secret are trusted.
// Compared in constant time against the raw (pre-parse) request body.
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !header) return false
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Pull the submitted field values for a Lead Ads lead. Meta only pushes the
// leadgen_id in the webhook; the actual name/phone/email must be fetched with
// the Page token. Returns a flat { field_name: value } map.
export async function fetchLeadFields(
  leadgenId: string,
  pageToken: string
): Promise<Record<string, string>> {
  const url = `${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(pageToken)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`lead fetch failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { field_data?: { name: string; values: string[] }[] }
  const out: Record<string, string> = {}
  for (const f of json.field_data ?? []) out[f.name] = f.values?.[0] ?? ''
  return out
}

// Look up a Messenger user's display name (the webhook carries only a PSID).
export async function fetchUserName(psid: string, pageToken: string): Promise<string | null> {
  try {
    const url = `${GRAPH}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageToken)}`
    const res = await fetch(url)
    if (!res.ok) return null
    const j = (await res.json()) as { first_name?: string; last_name?: string }
    const name = [j.first_name, j.last_name].filter(Boolean).join(' ').trim()
    return name || null
  } catch {
    return null
  }
}

// Send a text reply back to a Messenger user through the Page.
export async function sendMessage(
  psid: string,
  text: string,
  pageToken: string
): Promise<void> {
  const url = `${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text },
    }),
  })
  if (!res.ok) throw new Error(`send failed: ${res.status} ${await res.text()}`)
}
