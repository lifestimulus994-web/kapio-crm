// Shared formatting helpers used across server components.

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'GEL',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
})

// Format a number as Georgian Lari, e.g. 5000 -> "₾5,000".
export function formatCurrency(value: number): string {
  return currency.format(Number.isFinite(value) ? value : 0)
}

// Format a date string (e.g. "2026-06-12") as "Jun 12, 2026".
export function formatDate(date: string | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Format a timestamp as "Jun 12, 2026, 13:44" (used for comment times).
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// True if a task's end date is in the past and the task isn't done yet.
export function isOverdue(
  dueDate: string | null | undefined,
  status: string
): boolean {
  if (!dueDate || status === 'done') return false
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return false
  // Compare by calendar day: overdue only once the day has fully passed.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime()
}

// Join a person's first and last name, trimming any missing part.
export function fullName(person: {
  first_name: string
  last_name: string
}): string {
  return `${person.first_name} ${person.last_name}`.trim()
}
