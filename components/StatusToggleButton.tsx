'use client'

import { useFormStatus } from 'react-dom'
import { Check, Loader2 } from 'lucide-react'
import type { TaskStatus } from '@/types'

// Wraps the status dot in its own component so useFormStatus only reflects
// this button's own <form>, not every form on the page.
export default function StatusToggleButton({ status }: { status: TaskStatus }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      title="Advance status"
      disabled={pending}
      className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
        status === 'done'
          ? 'border-emerald-500 bg-emerald-500 text-white'
          : status === 'in_progress'
            ? 'border-amber-500 text-amber-500'
            : 'border-slate-600 text-transparent hover:border-slate-400'
      } ${pending ? 'opacity-50' : ''}`}
    >
      {pending ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        status === 'done' && <Check size={11} />
      )}
    </button>
  )
}
