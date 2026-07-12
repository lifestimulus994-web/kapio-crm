import { supabase } from '@/lib/supabase'
import { requireMember, hasElevatedAccess } from '@/lib/auth'
import type { Organization } from '@/types'
import RecordsTable, { type TableRow } from '@/components/RecordsTable'

export const dynamic = 'force-dynamic'

export default async function OrganizationsPage() {
  const me = await requireMember()
  const elevated = hasElevatedAccess(me)
  let query = supabase
    .from('organizations')
    .select('*, assignee:members(id, full_name, email)')
    .eq('workspace_id', me.workspace_id)
    .eq('archived', false)
    .order('name')

  if (!elevated) {
    query = query.eq('assigned_to', me.id)
  }

  const { data, error } = await query

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Failed to load organizations: {error.message}
      </div>
    )
  }

  const organizations = (data ?? []) as Organization[]

  const rows: TableRow[] = organizations.map((org) => {
    const website = org.website?.trim() || ''
    const websiteHref = website
      ? website.startsWith('http')
        ? website
        : `https://${website}`
      : undefined
    return {
      id: org.id,
      href: `/organizations/${org.id}`,
      avatar: org.name.charAt(0).toUpperCase(),
      title: org.name,
      subtitle: org.industry || org.legal_name || '',
      cells: [
        { value: org.identification_code },
        { value: org.phone, href: org.phone ? `tel:${org.phone}` : undefined },
        {
          value: org.email,
          href: org.email ? `mailto:${org.email}` : undefined,
        },
        {
          value: website.replace(/^https?:\/\//, ''),
          href: websiteHref,
          external: true,
        },
        ...(elevated
          ? [{ value: org.assignee?.full_name || org.assignee?.email || 'Unassigned' }]
          : []),
      ],
      searchText: [
        org.name,
        org.legal_name,
        org.industry,
        org.email,
        org.phone,
        org.website,
        org.identification_code,
        org.assignee?.full_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  })

  return (
    <RecordsTable
      rows={rows}
      columns={
        elevated
          ? ['ID Code', 'Phone', 'Email', 'Website', 'Assigned to']
          : ['ID Code', 'Phone', 'Email', 'Website']
      }
      tabs={[
        { label: 'Organizations', href: '/organizations', active: true },
        { label: 'Contacts', href: '/contacts' },
      ]}
      createHref="/organizations/new"
      createLabel="Create"
      searchPlaceholder="Search organizations…"
      avatarVariant="org"
      emptyText="No organizations yet. Add your first one."
    />
  )
}
