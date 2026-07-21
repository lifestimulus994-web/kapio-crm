import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/auth'
import { getMonthlyUsageUsd } from '@/lib/ai-usage'

export const dynamic = 'force-dynamic'

function startOfMonthIso(): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

// Inbox / AI analytics for the current workspace, this month. Every number is a
// count the owner can act on: how much the AI is handling, how many bookings
// and leads it produced, and what it cost.
export async function GET() {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: 'შესვლა საჭიროა' }, { status: 401 })
  const ws = me.workspace_id
  const since = startOfMonthIso()

  const msgIn = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .eq('direction', 'in')
    .gte('created_at', since)
  const msgOut = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .eq('direction', 'out')
    .gte('created_at', since)
  const convAll = supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
  const convHuman = supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .eq('needs_human', true)
  const convBooked = supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .eq('booking_stage', 'booked')
  const convHot = supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .gte('lead_score', 55)
  const leadsMonth = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws)
    .gte('created_at', since)

  const [rIn, rOut, rAll, rHuman, rBooked, rHot, rLeads, costUsd] = await Promise.all([
    msgIn,
    msgOut,
    convAll,
    convHuman,
    convBooked,
    convHot,
    leadsMonth,
    getMonthlyUsageUsd(ws),
  ])

  const conversations = rAll.count ?? 0
  const needsHuman = rHuman.count ?? 0
  const resolutionRate =
    conversations > 0 ? Math.round(((conversations - needsHuman) / conversations) * 100) : 0

  return NextResponse.json({
    messages_in: rIn.count ?? 0,
    messages_out: rOut.count ?? 0,
    conversations,
    needs_human: needsHuman,
    resolution_rate: resolutionRate,
    bookings: rBooked.count ?? 0,
    hot_leads: rHot.count ?? 0,
    leads_this_month: rLeads.count ?? 0,
    cost_usd: Number(costUsd.toFixed(2)),
  })
}
