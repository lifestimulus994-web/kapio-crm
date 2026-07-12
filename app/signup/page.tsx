'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [businessName, setBusinessName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: businessName,
          full_name: fullName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    setLoading(false)

    if (error) {
      setError(
        error.message.includes('already registered')
          ? 'ეს ელფოსტა უკვე რეგისტრირებულია'
          : 'რეგისტრაცია ვერ მოხერხდა, სცადე თავიდან'
      )
      return
    }

    if (data.session) {
      // Email confirmation is off — trigger already provisioned the
      // workspace, session exists immediately, go straight in.
      router.push('/dashboard')
      router.refresh()
      return
    }

    // Email confirmation required — the workspace is still provisioned by
    // the DB trigger the moment auth.users gets the row, so once they
    // confirm and log in, /dashboard just works.
    setCheckEmail(true)
  }

  if (checkEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <Image src="/logo.png" alt="Kapio" width={32} height={32} className="rounded-lg" />
            <span className="text-lg font-semibold text-slate-100">Kapio</span>
          </div>
          <h1 className="text-base font-semibold text-slate-100">შეამოწმე ელფოსტა</h1>
          <p className="text-sm text-slate-400">
            გაგზავნილია დამადასტურებელი ბმული — <span className="text-slate-200">{email}</span>-ზე.
            დააჭირე ბმულს და შემდეგ შედი შენს ანგარიშში.
          </p>
          <Link
            href="/login"
            className="inline-block text-sm font-medium text-emerald-400 hover:text-emerald-300"
          >
            შესვლის გვერდზე დაბრუნება
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-8"
      >
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Kapio" width={32} height={32} className="rounded-lg" />
          <span className="text-lg font-semibold text-slate-100">Kapio CRM</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">ბიზნესის სახელი</label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="მაგ: Onyx Studio"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none placeholder-slate-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">სახელი გვარი</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">ელფოსტა</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">პაროლი</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="მინიმუმ 6 სიმბოლო"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none placeholder-slate-500 focus:border-emerald-500"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? 'იქმნება...' : 'ანგარიშის შექმნა'}
        </button>

        <p className="text-center text-xs text-slate-500">
          უკვე გაქვს ანგარიში?{' '}
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
            შესვლა
          </Link>
        </p>
      </form>
    </div>
  )
}
