import { supabase } from '@/lib/supabase'

// ---------- shared ----------
// Sales/business-development vacancies only (per Daviti's explicit choice) —
// everything else on jobs.ge/hr.ge is noise for a CRM/sales-training business.
// Matched case-insensitively against the vacancy title (+ hr.ge's description).
const SALES_KEYWORDS = [
  'გაყიდვ', // გაყიდვები / გაყიდვების (Georgian: sales)
  'სავაჭრო',
  'დისტრიბუტორ',
  'მენეჯერი გაყიდვ',
  'საკონტაქტო ცენტრ',
  'sales',
  'account manager',
  'business development',
  'call center',
  'call-center',
  'callcenter',
]

function matchesSalesKeyword(text: string): boolean {
  const t = text.toLowerCase()
  return SALES_KEYWORDS.some((k) => t.includes(k.toLowerCase()))
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim()
}

type FoundPosting = {
  source: 'jobs.ge' | 'hr.ge'
  externalId: string
  companyName: string
  title: string
  postedAt: string | null // YYYY-MM-DD
  url: string
}

async function upsertPostings(postings: FoundPosting[]): Promise<number> {
  if (postings.length === 0) return 0
  const { error } = await supabase.from('job_postings').upsert(
    postings.map((p) => ({
      source: p.source,
      external_id: p.externalId,
      company_name: p.companyName,
      title: p.title,
      posted_at: p.postedAt,
      url: p.url,
    })),
    { onConflict: 'source,external_id' }
  )
  if (error) throw new Error(`upsert failed: ${error.message}`)
  return postings.length
}

// ---------- jobs.ge ----------
// Georgian month names as jobs.ge prints them ("15 ივლისი") — no year, so we
// infer the current year, rolling back a year if the month is far in the
// "future" relative to today (handles the Dec-listing-viewed-in-Jan edge).
const GEORGIAN_MONTHS: Record<string, number> = {
  იანვარი: 1,
  თებერვალი: 2,
  მარტი: 3,
  აპრილი: 4,
  მაისი: 5,
  ივნისი: 6,
  ივლისი: 7,
  აგვისტო: 8,
  სექტემბერი: 9,
  ოქტომბერი: 10,
  ნოემბერი: 11,
  დეკემბერი: 12,
}

function parseJobsGeDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([ა-ჰ]+)/)
  if (!m) return null
  const day = Number(m[1])
  const month = GEORGIAN_MONTHS[m[2]]
  if (!month || !day) return null
  const now = new Date()
  let year = now.getUTCFullYear()
  // If this month+day would be more than ~2 months in the future, it's
  // almost certainly from last year (listing viewed near a year boundary).
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getTime() - now.getTime() > 60 * 24 * 3600 * 1000) year -= 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// cid=2 is jobs.ge's own "გაყიდვები" (Sales) category — narrows the fetch to
// relevant listings before the keyword filter is even applied.
const JOBS_GE_SALES_CATEGORY_URL = 'https://jobs.ge/?cid=2'

export async function syncJobsGe(): Promise<{ found: number; saved: number }> {
  const res = await fetch(JOBS_GE_SALES_CATEGORY_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KapioCRM/1.0)' },
  })
  if (!res.ok) throw new Error(`jobs.ge fetch failed: ${res.status}`)
  const html = await res.text()

  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []
  const postings: FoundPosting[] = []

  for (const row of rows) {
    const idMatch = row.match(/view=jobs&id=(\d+)/)
    if (!idMatch) continue
    const externalId = idMatch[1]

    const titleMatch = row.match(
      new RegExp(`view=jobs&id=${externalId}"[^>]*class="vip">([^<]+)<`)
    )
    if (!titleMatch) continue
    const title = decodeEntities(titleMatch[1])
    if (!matchesSalesKeyword(title)) continue

    // Two <a view=client> links per row (logo icon, then the name as text) —
    // the icon one has no text between its tags, so the first non-empty
    // decoded text among all matches is always the real company name; a
    // fully anonymous posting has neither and falls back below.
    const clientLinkTexts = Array.from(
      row.matchAll(/view=client&client=[a-z0-9_-]+"[^>]*>([^<]*)</g)
    ).map((m) => decodeEntities(m[1]))
    const companyName = clientLinkTexts.find((t) => t.length > 0) ?? 'უცნობი კომპანია'

    const dateMatch = row.match(/<td\s*>(\d{1,2}\s+[ა-ჰ]+)\s*<\/td>/)
    const postedAt = dateMatch ? parseJobsGeDate(dateMatch[1]) : null

    postings.push({
      source: 'jobs.ge',
      externalId,
      companyName,
      title,
      postedAt,
      url: `https://jobs.ge/ge/?view=jobs&id=${externalId}`,
    })
  }

  const saved = await upsertPostings(postings)
  return { found: rows.length, saved }
}

// ---------- hr.ge ----------
// No documented public search API — instead: walk the sitemap (newest
// /announcement/{id}/{slug} first, ids are roughly sequential), stop at the
// first id we've already stored, and fetch each NEW id's own detail JSON
// (a real, working endpoint) to check its title for a sales-keyword match.
// Bounded by MAX_NEW_PER_SYNC so a first-ever run (nothing stored yet)
// cannot fire hundreds of requests at once.
const HR_GE_SITEMAP_URL = 'https://api.p.hr.ge/public-portal/tenant/1/api/v3/seo/sitemap'
const HR_GE_ANNOUNCEMENT_API = (id: string) =>
  `https://api.p.hr.ge/public-portal/tenant/1/api/v3/announcement/${id}`
// hr.ge posts roughly 150-200 new listings/day site-wide (all categories) —
// bounds both a day's normal volume and a first-ever run (nothing checked
// yet) to a request count that fits the cron function's time budget.
const MAX_NEW_PER_SYNC = 120

// "Checked up to" watermark — see the job_sync_state comment in schema.sql
// for why this must track every id CHECKED, not just the ones that matched.
async function getLastCheckedHrGeId(): Promise<number> {
  const { data } = await supabase
    .from('job_sync_state')
    .select('last_id')
    .eq('source', 'hr.ge')
    .maybeSingle()
  return data?.last_id ?? 0
}

async function setLastCheckedHrGeId(id: number): Promise<void> {
  await supabase.from('job_sync_state').upsert({ source: 'hr.ge', last_id: id })
}

export async function syncHrGe(): Promise<{ found: number; saved: number }> {
  const res = await fetch(HR_GE_SITEMAP_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KapioCRM/1.0)', Accept: 'application/xml' },
  })
  if (!res.ok) throw new Error(`hr.ge sitemap fetch failed: ${res.status}`)
  const xml = await res.text()

  const ids = Array.from(
    new Set(
      Array.from(xml.matchAll(/\/announcement\/(\d+)\//g)).map((m) => Number(m[1]))
    )
  ).sort((a, b) => b - a) // newest (highest id) first

  const lastChecked = await getLastCheckedHrGeId()
  const candidateIds = ids.filter((id) => id > lastChecked).slice(0, MAX_NEW_PER_SYNC)

  const postings: FoundPosting[] = []
  for (const id of candidateIds) {
    try {
      // Sequential with a small gap — polite to hr.ge's API, and avoids
      // looking like a burst of automated traffic.
      await new Promise((r) => setTimeout(r, 80))
      const detailRes = await fetch(HR_GE_ANNOUNCEMENT_API(String(id)), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KapioCRM/1.0)', Accept: 'application/json' },
      })
      if (!detailRes.ok) continue
      const data = (await detailRes.json()) as {
        data?: {
          announcement?: {
            title?: string
            customerName?: string
            publishDate?: string
          }
        }
      }
      const a = data.data?.announcement
      if (!a?.title) continue
      if (!matchesSalesKeyword(a.title)) continue
      postings.push({
        source: 'hr.ge',
        externalId: String(id),
        companyName: a.customerName || 'უცნობი კომპანია',
        title: a.title,
        postedAt: a.publishDate ? a.publishDate.slice(0, 10) : null,
        url: `https://www.hr.ge/announcement/${id}`,
      })
    } catch {
      // One bad announcement shouldn't stop the rest of the sync.
      continue
    }
  }

  const saved = await upsertPostings(postings)
  // Advance the watermark to the highest id actually CHECKED this run (not
  // just the ones that matched) — candidateIds is sorted newest-first.
  if (candidateIds.length > 0) await setLastCheckedHrGeId(candidateIds[0])
  return { found: candidateIds.length, saved }
}

export async function syncJobBoards(): Promise<{
  jobsGe: { found: number; saved: number } | { error: string }
  hrGe: { found: number; saved: number } | { error: string }
}> {
  const [jobsGe, hrGe] = await Promise.allSettled([syncJobsGe(), syncHrGe()])
  return {
    jobsGe: jobsGe.status === 'fulfilled' ? jobsGe.value : { error: jobsGe.reason?.message ?? 'failed' },
    hrGe: hrGe.status === 'fulfilled' ? hrGe.value : { error: hrGe.reason?.message ?? 'failed' },
  }
}
