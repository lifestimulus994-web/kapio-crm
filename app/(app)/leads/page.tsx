import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import type { Lead } from '@/types'
import RecordsTable, { type TableRow } from '@/components/RecordsTable'

export const dynamic = 'force-dynamic'

const statusLabel: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  lost: 'Lost',
}

export default async function LeadsPage() {
  const me = await requireMember()

  let query = supabase
    .from('leads')
    .select('*, assignee:members(id, full_name, email)')
    .order('created_at', { ascending: false })

  if (me.role !== 'owner') {
    query = query.eq('assigned_to', me.id)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load leads: {error.message}
      </div>
    )
  }

  const leads = (data ?? []) as Lead[]

  const rows: TableRow[] = leads.map((l) => ({
    id: l.id,
    href: `/leads/${l.id}`,
    avatar: l.full_name.charAt(0).toUpperCase(),
    title: l.full_name,
    subtitle: l.company || '',
    cells: [
      { value: l.phone ?? '', href: l.phone ? `tel:${l.phone}` : undefined },
      { value: statusLabel[l.status] ?? l.status },
      { value: l.assignee?.full_name || l.assignee?.email || 'Unassigned' },
    ],
    searchText: [l.full_name, l.company, l.phone, l.email, l.source, l.assignee?.full_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))

  return (
    <RecordsTable
      rows={rows}
      columns={['Phone', 'Status', 'Assigned to']}
      tabs={[{ label: 'Leads', href: '/leads', active: true }]}
      createHref="/leads/new"
      createLabel="Create"
      searchPlaceholder="Search leads…"
      avatarVariant="contact"
      emptyText={
        me.role === 'owner'
          ? 'No leads yet. Add your first one.'
          : 'No leads assigned to you yet.'
      }
    />
  )
}
