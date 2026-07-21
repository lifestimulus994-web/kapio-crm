// ---------------------------------------------------------------------------
// Lightweight retrieval (RAG-lite). When a workspace's knowledge is small we
// send it whole — it's cheap and most accurate. When it grows large AND is
// structured into "## sections", we select only the sections relevant to the
// customer's question (plus the first/company section), so big knowledge bases
// don't blow up token cost or dilute the answer. No embeddings needed for this
// scale; a keyword-overlap score over headings/sections is enough.
// ---------------------------------------------------------------------------

const FULL_BELOW_CHARS = 6000 // below this, just send everything
const MAX_SECTIONS = 4

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
}

export function selectKnowledge(knowledge: string, question: string): string {
  const k = knowledge ?? ''
  if (k.length < FULL_BELOW_CHARS || !/^##\s/m.test(k)) return k

  // Split into sections, keeping each "## heading" with its body.
  const parts = k.split(/^(?=##\s)/m).map((p) => p.trim()).filter(Boolean)
  if (parts.length <= MAX_SECTIONS) return k

  const qWords = new Set(words(question))
  const scored = parts.map((section, idx) => {
    const sWords = words(section)
    let score = 0
    for (const w of sWords) if (qWords.has(w)) score++
    return { section, idx, score }
  })

  // Always keep the first section (usually company/contact basics), then the
  // highest-scoring others.
  const first = scored[0]
  const rest = scored
    .slice(1)
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECTIONS - 1)

  const chosen = [first, ...rest].sort((a, b) => a.idx - b.idx)
  return chosen.map((c) => c.section).join('\n\n')
}
