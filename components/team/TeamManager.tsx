'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, UserPlus } from 'lucide-react'
import type { Member } from '@/lib/auth'

export default function TeamManager({
  members,
  currentUserId,
}: {
  members: Member[]
  currentUserId: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'member' | 'manager'>('member')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: fullName, role }),
    })
    const data = await res.json()

    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? 'ვერ დაემატა')
      return
    }

    setEmail('')
    setPassword('')
    setFullName('')
    setRole('member')
    router.refresh()
  }

  async function handleRemove(id: string) {
    if (!confirm('წავშალო წევრი? მისი შესვლა დაუყოვნებლივ გაითიშება.')) return
    setRemovingId(id)
    const res = await fetch(`/api/team/${id}`, { method: 'DELETE' })
    setRemovingId(null)
    if (!res.ok) {
      const data = await res.json()
      alert(data.error ?? 'ვერ წაიშალა')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-slate-800 divide-y divide-slate-800">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-100">
                {m.full_name || m.email}
                {m.id === currentUserId && (
                  <span className="ml-2 text-xs text-slate-500">(შენ)</span>
                )}
              </div>
              <div className="text-xs text-slate-500">{m.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  m.role === 'owner'
                    ? 'bg-emerald-900/40 text-emerald-400'
                    : m.role === 'manager'
                      ? 'bg-blue-900/40 text-blue-400'
                      : 'bg-slate-800 text-slate-400'
                }`}
              >
                {m.role === 'owner' ? 'Owner' : m.role === 'manager' ? 'Manager' : 'Member'}
              </span>
              {m.role !== 'owner' && (
                <button
                  onClick={() => handleRemove(m.id)}
                  disabled={removingId === m.id}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-950/40 hover:text-red-400 disabled:opacity-50"
                  title="წევრის წაშლა"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="max-w-md space-y-3 rounded-xl border border-slate-800 p-5"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <UserPlus size={16} />
          წევრის დამატება
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">სახელი</label>
          <input
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">პაროლი</label>
          <input
            type="text"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="მინიმუმ 6 სიმბოლო"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">როლი</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'manager')}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
          >
            <option value="member">Member — მხოლოდ საკუთარი ჩანაწერები</option>
            <option value="manager">Manager — ხედავს/მართავს მთელ გუნდს</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? 'დამატება...' : 'დამატება'}
        </button>
      </form>
    </div>
  )
}
