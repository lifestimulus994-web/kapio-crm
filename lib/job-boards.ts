import { supabase } from '@/lib/supabase'

// ---------- shared ----------
// ALL vacancies from both sites — no keyword/category filter. The AI's
// get_job_postings tool can still be asked about a specific role or company;
// narrowing happens at query time, not at sync time.

// Runs `items` through `worker` with at most `concurrency` in flight at
// once — hr.ge has no bulk endpoint, so covering a full day's volume (a few
// hundred ids) inside Vercel's function time limit means overlapping
// requests instead of one-at-a-time.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
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

// No cid param = every category on one page (jobs.ge doesn't paginate this
// view — see the dead infinite-scroll JS in its own markup, loaded_page<0
// is never true, so the initial render already has everything live).
const JOBS_GE_ALL_URL = 'https://jobs.ge/'

export async function syncJobsGe(): Promise<{ found: number; saved: number }> {
  const res = await fetch(JOBS_GE_ALL_URL, {
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
// first id we've already checked, and fetch each NEW id's own detail JSON
// (a real, working endpoint). Every one found is saved — no keyword filter.
// Fetched with bounded concurrency (not one-at-a-time): measured ~0.6-0.7s
// per detail request, and hr.ge posts ~150-200 new listings/day site-wide,
// which a sequential loop can't cover inside Vercel's 60s function ceiling.
const HR_GE_SITEMAP_URL = 'https://api.p.hr.ge/public-portal/tenant/1/api/v3/seo/sitemap'
const HR_GE_ANNOUNCEMENT_API = (id: string) =>
  `https://api.p.hr.ge/public-portal/tenant/1/api/v3/announcement/${id}`
// Comfortably above the ~150-200/day estimate, so the watermark keeps up
// with real volume instead of permanently lagging behind it.
const MAX_NEW_PER_SYNC = 350
const HR_GE_CONCURRENCY = 12

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

  const results = await mapWithConcurrency(candidateIds, HR_GE_CONCURRENCY, async (id) => {
    try {
      const detailRes = await fetch(HR_GE_ANNOUNCEMENT_API(String(id)), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KapioCRM/1.0)', Accept: 'application/json' },
      })
      if (!detailRes.ok) return null
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
      if (!a?.title) return null
      const posting: FoundPosting = {
        source: 'hr.ge',
        externalId: String(id),
        companyName: a.customerName || 'უცნობი კომპანია',
        title: a.title,
        postedAt: a.publishDate ? a.publishDate.slice(0, 10) : null,
        url: `https://www.hr.ge/announcement/${id}`,
      }
      return posting
    } catch {
      // One bad announcement shouldn't stop the rest of the sync.
      return null
    }
  })
  const postings = results.filter((p): p is FoundPosting => p !== null)

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
