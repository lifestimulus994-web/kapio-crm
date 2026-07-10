// Lightweight loading skeletons shown instantly during navigation (via each
// section's loading.tsx) while the server fetches data. They mirror the real
// layouts so the jump from skeleton → content is barely noticeable.

function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-slate-800 ${className}`} />
}

function Header({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
      <div className="space-y-2">
        <Bar className="h-4 w-28" />
        <Bar className="h-2.5 w-40" />
      </div>
      <Bar className={`h-9 ${wide ? 'w-44' : 'w-28'}`} />
    </div>
  )
}

// Generic list / table skeleton (Organizations, Contacts, Tasks list).
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex h-full animate-pulse flex-col">
      <Header />
      <div className="flex-1 space-y-2 px-6 py-5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
          >
            <Bar className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3 w-1/3" />
              <Bar className="h-2.5 w-1/4" />
            </div>
            <Bar className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Pipeline board skeleton (Kanban columns).
export function BoardSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex h-full animate-pulse flex-col">
      <Header wide />
      <div className="flex flex-1 gap-4 overflow-hidden px-6 py-5">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="w-64 shrink-0 space-y-3">
            <Bar className="h-3 w-24" />
            {Array.from({ length: 3 }).map((_, r) => (
              <div
                key={r}
                className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
              >
                <Bar className="h-3 w-3/4" />
                <Bar className="h-2.5 w-1/2" />
                <Bar className="h-5 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Weekly calendar skeleton (7-day grid).
export function CalendarSkeleton() {
  return (
    <div className="flex h-full animate-pulse flex-col">
      <Header />
      <div className="grid flex-1 grid-cols-7 gap-px bg-slate-800 px-px py-px">
        {Array.from({ length: 7 }).map((_, d) => (
          <div key={d} className="space-y-2 bg-slate-950 p-2">
            <Bar className="mx-auto h-6 w-6 rounded-full" />
            {Array.from({ length: (d % 3) + 1 }).map((_, e) => (
              <Bar
                key={e}
                className="h-10 w-full bg-slate-800/70"
                aria-hidden
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Detail-page skeleton (record header + a couple of panels).
export function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse px-6 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Bar className="h-6 w-6" />
        <div className="flex-1 space-y-2">
          <Bar className="h-4 w-1/3" />
          <Bar className="h-2.5 w-1/4" />
        </div>
      </div>
      <div className="space-y-4">
        <Bar className="h-28 w-full rounded-xl" />
        <Bar className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}
