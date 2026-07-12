import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <Image src="/logo.png" alt="Kapio" width={32} height={32} className="rounded-lg" />
          <span className="text-lg font-semibold text-slate-100">Kapio</span>
        </div>

        <div>
          <p className="text-4xl font-bold text-emerald-500">404</p>
          <h1 className="mt-2 text-base font-semibold text-slate-100">
            გვერდი ვერ მოიძებნა
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            მისამართი, რომელსაც ეძებ, არ არსებობს ან წაშლილია.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          <ArrowLeft size={15} />
          მთავარ გვერდზე დაბრუნება
        </Link>
      </div>
    </div>
  )
}
