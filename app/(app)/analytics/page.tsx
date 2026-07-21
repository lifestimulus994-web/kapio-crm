import { requireMember } from '@/lib/auth'
import Analytics from '@/components/Analytics'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ანალიტიკა — Kapio CRM' }

export default async function AnalyticsPage() {
  await requireMember()
  return <Analytics />
}
