import { requireMember } from '@/lib/auth'
import Inbox from '@/components/Inbox'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'შემოსული — Kapio CRM' }

export default async function InboxPage() {
  await requireMember()
  return (
    <div className="h-full">
      <Inbox />
    </div>
  )
}
