// Deterministically maps a member id to one of a fixed palette of colors, so
// the same person always shows the same color everywhere a record's
// assignee is displayed — the whole point being that with 3+ employees you
// can tell who owns what at a glance without reading every name.
const PALETTE = [
  { dot: 'bg-emerald-500', text: 'text-emerald-400' },
  { dot: 'bg-blue-500', text: 'text-blue-400' },
  { dot: 'bg-amber-500', text: 'text-amber-400' },
  { dot: 'bg-violet-500', text: 'text-violet-400' },
  { dot: 'bg-pink-500', text: 'text-pink-400' },
  { dot: 'bg-cyan-500', text: 'text-cyan-400' },
  { dot: 'bg-orange-500', text: 'text-orange-400' },
  { dot: 'bg-rose-500', text: 'text-rose-400' },
] as const

export function memberColor(memberId: string | null | undefined): (typeof PALETTE)[number] | null {
  if (!memberId) return null
  let hash = 0
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
