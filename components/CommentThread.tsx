import { formatDateTime } from '@/lib/utils'

type Comment = {
  id: string
  author: string
  body: string
  created_at: string
}

// Shared comment list + add-comment form, used on the organization, contact,
// opportunity, and task detail pages. Each page owns its own server action
// (different table/foreign key) and passes it in as `addComment`.
export default function CommentThread({
  comments,
  commentsReady,
  addComment,
  defaultAuthor = '',
}: {
  comments: Comment[]
  commentsReady: boolean
  addComment: (formData: FormData) => void | Promise<void>
  defaultAuthor?: string
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-300 mb-3">
        Comments{' '}
        <span className="text-slate-600 font-normal">({comments.length})</span>
      </h2>

      {!commentsReady && (
        <div className="mb-3 rounded-lg border border-amber-900/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
          Comments need a quick database migration — run the SQL in
          <span className="font-mono"> schema.sql</span> to enable them.
        </div>
      )}

      {/* Add comment */}
      <form
        action={addComment}
        className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3 mb-4"
      >
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Write a comment…"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 resize-none"
        />
        <div className="flex items-center gap-2 mt-2">
          <input
            name="author"
            defaultValue={defaultAuthor}
            placeholder="Your name"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
          />
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex-none"
          >
            Comment
          </button>
        </div>
      </form>

      {/* Comment list */}
      <div className="space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300 flex-none">
              {(c.author || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-slate-200">{c.author}</span>
                <span className="text-[11px] text-slate-500">
                  {formatDateTime(c.created_at)}
                </span>
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed mt-0.5">
                {c.body}
              </p>
            </div>
          </div>
        ))}
        {comments.length === 0 && commentsReady && (
          <p className="text-xs text-slate-600 py-2">No comments yet. Be the first.</p>
        )}
      </div>
    </div>
  )
}
