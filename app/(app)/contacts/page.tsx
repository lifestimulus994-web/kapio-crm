import { supabase } from '@/lib/supabase'
import { requireMember, hasElevatedAccess } from '@/lib/auth'
import type { Contact } from '@/types'
import { fullName } from '@/lib/utils'
import RecordsTable, { type TableRow } from '@/components/RecordsTable'
import { memberColor } from '@/lib/member-color'

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  const me = await requireMember()
  const elevated = hasElevatedAccess(me)
  let query = supabase
    .from('contacts')
    .select('*, organization:organizations(id, name), assignee:members(id, full_name, email)')
    .eq('workspace_id', me.workspace_id)
    .eq('archived', false)
    .order('first_name')

  if (!elevated) {
    query = query.eq('assigned_to', me.id)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load contacts: {error.message}
      </div>
    )
  }

  const contacts = (data ?? []) as Contact[]

  const rows: TableRow[] = contacts.map((c) => ({
    id: c.id,
    href: `/contacts/${c.id}`,
    avatar:
      `${c.first_name.charAt(0)}${c.last_name.charAt(0)}`.toUpperCase() ||
      c.first_name.charAt(0).toUpperCase(),
    title: fullName(c),
    subtitle: c.job_title || '',
    cells: [
      {
        value: c.organization?.name ?? '',
        href: c.organization ? `/organizations/${c.organization.id}` : undefined,
      },
      { value: c.phone ?? '', href: c.phone ? `tel:${c.phone}` : undefined },
      {
        value: c.email ?? '',
        href: c.email ? `mailto:${c.email}` : undefined,
      },
      ...(elevated
        ? [
            {
              value: c.assignee?.full_name || c.assignee?.email || 'Unassigned',
              dotColor: memberColor(c.assigned_to)?.dot,
            },
          ]
        : []),
    ],
    searchText: [
      fullName(c),
      c.job_title,
      c.email,
      c.phone,
      c.organization?.name,
      c.assignee?.full_name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))

  return (
    <RecordsTable
      rows={rows}
      columns={elevated ? ['Organization', 'Phone', 'Email', 'Assigned to'] : ['Organization', 'Phone', 'Email']}
      tabs={[
        { label: 'Organizations', href: '/organizations' },
        { label: 'Contacts', href: '/contacts', active: true },
      ]}
      createHref="/contacts/new"
      createLabel="Create"
      searchPlaceholder="Search contacts…"
      avatarVariant="contact"
      emptyText="No contacts yet. Add your first one."
    />
  )
}
