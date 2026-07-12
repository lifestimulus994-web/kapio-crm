import { supabase } from '@/lib/supabase'
import { requireMember } from '@/lib/auth'
import type { Organization } from '@/types'
import RecordsTable, { type TableRow } from '@/components/RecordsTable'

export const dynamic = 'force-dynamic'

export default async function OrganizationsPage() {
  const me = await requireMember()
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('workspace_id', me.workspace_id)
    .eq('archived', false)
    .order('name')

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
      ],
      searchText: [
        org.name,
        org.legal_name,
        org.industry,
        org.email,
        org.phone,
        org.website,
        org.identification_code,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  })

  return (
    <RecordsTable
      rows={rows}
      columns={['Phone', 'Email', 'Website']}
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
