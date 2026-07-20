import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import AIAssistant from '@/components/AIAssistant'
import { requireMember } from '@/lib/auth'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const member = await requireMember()

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      <Sidebar email={member.email} isOwner={member.role === 'owner'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar email={member.email} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <AIAssistant />
    </div>
  )
}
