'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'

export default function NewBoardButton() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function create() {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/boards', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.board?.id) {
        router.push(`/boards/${data.board.id}`)
        return
      }
      alert(data.error ?? 'დაფის შექმნა ვერ მოხერხდა.')
    } catch {
      alert('ქსელის შეცდომა.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <button
      onClick={create}
      disabled={creating}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
    >
      {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
      ახალი დაფა
    </button>
  )
}
