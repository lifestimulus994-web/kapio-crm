'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, X, Sparkles } from 'lucide-react'
import AIChat from '@/components/AIChat'

// Floating corner launcher + panel. The chat itself lives in AIChat, shared
// with the full-screen /ai page — where this widget would be redundant, so it
// hides itself there.
export default function AIAssistant() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  if (pathname.startsWith('/ai')) return null

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 shadow-lg shadow-emerald-900/40 transition-colors"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium">კითხე AI-ს</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400">
                <Bot size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  AI ასისტენტი
                </p>
                <p className="text-[11px] text-slate-500">Powered by Kapio</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <AIChat variant="widget" />
        </div>
      )}
    </>
  )
}
