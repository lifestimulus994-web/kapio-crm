import Image from 'next/image'
import { redirect } from 'next/navigation'
import { Clock } from 'lucide-react'
import { getCurrentMember } from '@/lib/auth'
import LogoutButton from '@/components/LogoutButton'

export const dynamic = 'force-dynamic'

// Deliberately does NOT use requireMember() — that redirects a pending
// member HERE, which would be an infinite loop. Handles its own redirects.
export default async function PendingApprovalPage() {
  const me = await getCurrentMember()
  if (!me) redirect('/login')
  if (me.workspace_status === 'approved') redirect('/dashboard')

  const rejected = me.workspace_status === 'rejected'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <Image src="/logo.png" alt="Kapio" width={32} height={32} className="rounded-lg" />
          <span className="text-lg font-semibold text-slate-100">Kapio</span>
        </div>

        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            rejected ? 'bg-red-950/40 text-red-400' : 'bg-amber-950/40 text-amber-400'
          }`}
        >
          <Clock size={22} />
        </div>

        {rejected ? (
          <>
            <h1 className="text-base font-semibold text-slate-100">
              ანგარიში ვერ დამტკიცდა
            </h1>
            <p className="text-sm text-slate-400">
              დაგვიკავშირდი, თუ ფიქრობ, რომ ეს შეცდომაა.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold text-slate-100">
              ანგარიში განხილვის პროცესშია
            </h1>
            <p className="text-sm text-slate-400">
              შენი რეგისტრაცია მიღებულია — მალე დაგიდასტურდება. სამუშაო
              სივრცეში წვდომას მიიღებ დადასტურების შემდეგ.
            </p>
          </>
        )}

        <LogoutButton />
      </div>
    </div>
  )
}
