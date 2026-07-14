import { NextResponse } from 'next/server'
import { syncJobBoards } from '@/lib/job-boards'

export const dynamic = 'force-dynamic'
// Kept at 60 (the Vercel Hobby-plan ceiling) rather than requesting more —
// MAX_NEW_PER_SYNC in lib/job-boards.ts is tuned to finish comfortably
// inside that window rather than relying on a higher plan being available.
export const maxDuration = 60

// Vercel Cron (see vercel.json) hits this once a day. Vercel automatically
// sends `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when
// CRON_SECRET is set as a project env var — reject anything else so this
// endpoint can't be used to trigger a scrape run from outside.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncJobBoards()
  return NextResponse.json({ ok: true, ...result })
}
