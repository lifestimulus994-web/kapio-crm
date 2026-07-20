import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Thin wrappers around the Meta Graph API used by the omnichannel inbox
// (Facebook/Instagram Messenger + Lead Ads). Server-only: reads the app
// secret from the environment and Page tokens from channel_connections.
// ---------------------------------------------------------------------------

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

// OAuth scopes a client grants when connecting Facebook + Instagram. Messenger
// + Lead Ads for Pages, plus Instagram messaging for any IG account linked to
// a connected Page.
export const CONNECT_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'leads_retrieval',
  'business_management',
  'instagram_basic',
  'instagram_manage_messages',
].join(',')

// Webhook fields a Page is subscribed to when connected.
export const PAGE_SUBSCRIBE_FIELDS = 'messages,messaging_postbacks,messaging_referrals,leadgen'

function appId() {
  return process.env.META_APP_ID!
}
function appSecret() {
  return process.env.META_APP_SECRET!
}

// Build the Facebook OAuth dialog URL the "Connect" button sends the user to.
export function oauthDialogUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri,
    state,
    scope: CONNECT_SCOPES,
    response_type: 'code',
  })
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${p.toString()}`
}

// Exchange the OAuth `code` for a user access token, then upgrade it to a
// long-lived token (so the Page tokens derived from it don't expire).
export async function exchangeCodeForUserToken(
  code: string,
  redirectUri: string
): Promise<string> {
  const u = `${GRAPH}/oauth/access_token?client_id=${appId()}&client_secret=${appSecret()}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
  const r = await fetch(u)
  if (!r.ok) throw new Error(`code exchange failed: ${r.status} ${await r.text()}`)
  const shortToken = ((await r.json()) as { access_token: string }).access_token

  const l = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId()}&client_secret=${appSecret()}&fb_exchange_token=${encodeURIComponent(shortToken)}`
  const lr = await fetch(l)
  if (!lr.ok) return shortToken // fall back to the short token if upgrade fails
  return ((await lr.json()) as { access_token: string }).access_token
}

export type ConnectedPage = {
  id: string
  name: string
  access_token: string
  instagram?: { id: string; username?: string }
}

// List the Pages the user manages, each with its own long-lived Page token and
// any linked Instagram business account.
export async function listManagedPages(userToken: string): Promise<ConnectedPage[]> {
  const u = `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(userToken)}`
  const r = await fetch(u)
  if (!r.ok) throw new Error(`pages fetch failed: ${r.status} ${await r.text()}`)
  const j = (await r.json()) as {
    data?: {
      id: string
      name: string
      access_token: string
      instagram_business_account?: { id: string; username?: string }
    }[]
  }
  return (j.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
    instagram: p.instagram_business_account,
  }))
}

// Subscribe a Page to this app's webhook for the fields we handle.
export async function subscribePageToApp(pageId: string, pageToken: string): Promise<void> {
  const u = `${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=${PAGE_SUBSCRIBE_FIELDS}&access_token=${encodeURIComponent(pageToken)}`
  const r = await fetch(u, { method: 'POST' })
  if (!r.ok) throw new Error(`subscribe failed: ${r.status} ${await r.text()}`)
}

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
