import Sidebar from '@/components/Sidebar'
import AIAssistant from '@/components/AIAssistant'
import { requireMember } from '@/lib/auth'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const member = await requireMember()

  return (
    <div className="flex">
      <Sidebar email={member.email} isOwner={member.role === 'owner'} />
      <main className="flex-1 h-screen overflow-y-auto">{children}</main>
      <AIAssistant />
    </div>
  )
}
