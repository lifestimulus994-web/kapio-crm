'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  NodeResizer,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Plus, Trash2, Check, Loader2, Bold, Italic, Minus } from 'lucide-react'

// ---------------------------------------------------------------------------
// Sticky-note node: green card, black text, editable in place, vertically &
// horizontally centred like Miro. When selected, a floating toolbar lets you
// bold / italic / resize the text. Drag the round handles on the sides to draw
// an arrow to another note; the + button spawns a connected child to the right.
//
// Georgian text always renders in FiraGO; Latin falls back to the app's Geist
// (per-glyph fallback: Geist has no Georgian glyphs, so those pick up FiraGO).
// ---------------------------------------------------------------------------

const NOTE_FONT = 'var(--font-geist-sans), var(--font-firago), sans-serif'
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 48

type Formatting = { bold?: boolean; italic?: boolean; fontSize?: number }
type StickyData = Formatting & {
  text: string
  onChange: (id: string, text: string) => void
  onSpawn: (id: string) => void
  onFormat: (id: string, patch: Formatting) => void
}
type StickyNode = Node<StickyData, 'sticky'>

function StickyNoteNode({ id, data, selected }: NodeProps<StickyNode>) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fontSize = data.fontSize ?? DEFAULT_FONT_SIZE

  // Auto-grow the textarea to its content so flex-centring keeps the text in
  // the middle of the note (a textarea otherwise anchors text to the top).
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [data.text, fontSize, data.bold, data.italic])

  // Keep focus in the textarea when tapping a toolbar button so typing can
  // continue uninterrupted; nodrag stops the click from dragging the node.
  const hold = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div
      className={`h-full w-full rounded-lg border-2 bg-emerald-200 shadow-md transition-shadow ${
        selected ? 'border-emerald-500 shadow-lg' : 'border-emerald-300'
      }`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={80}
        lineClassName="!border-emerald-500"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border-emerald-600 !bg-white"
      />
      {/* Connection handles: one target (left) + one source (right). */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-emerald-600 !bg-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-emerald-600 !bg-white"
      />

      {/* Floating format toolbar (Miro-style) */}
      {selected && (
        <div
          onMouseDown={hold}
          className="nodrag nopan absolute -top-2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-800 px-1 py-1 text-slate-200 shadow-xl"
        >
          <button
            onClick={() => data.onFormat(id, { bold: !data.bold })}
            title="მუქი"
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-slate-700 ${
              data.bold ? 'bg-slate-700 text-white' : ''
            }`}
          >
            <Bold size={14} />
          </button>
          <button
            onClick={() => data.onFormat(id, { italic: !data.italic })}
            title="დახრილი"
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-slate-700 ${
              data.italic ? 'bg-slate-700 text-white' : ''
            }`}
          >
            <Italic size={14} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-slate-600" />
          <button
            onClick={() =>
              data.onFormat(id, { fontSize: Math.max(MIN_FONT_SIZE, fontSize - 2) })
            }
            title="შემცირება"
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-slate-700"
          >
            <Minus size={14} />
          </button>
          <span className="w-6 text-center text-xs tabular-nums text-slate-300">
            {fontSize}
          </span>
          <button
            onClick={() =>
              data.onFormat(id, { fontSize: Math.min(MAX_FONT_SIZE, fontSize + 2) })
            }
            title="გაზრდა"
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-slate-700"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      {/* Centred text: flex wrapper vertically & horizontally centres the
          auto-height textarea, so writing starts from the middle. */}
      <div className="flex h-full w-full items-center justify-center overflow-hidden p-2.5">
        <textarea
          ref={taRef}
          value={data.text}
          onChange={(e) => data.onChange(id, e.target.value)}
          placeholder="ჩაწერე…"
          rows={1}
          // nodrag/nopan: typing & selecting text must not drag the canvas.
          className="nodrag nopan w-full resize-none overflow-hidden bg-transparent text-center leading-snug text-slate-900 placeholder-emerald-700/50 focus:outline-none"
          style={{
            fontFamily: NOTE_FONT,
            fontSize,
            fontWeight: data.bold ? 700 : 500,
            fontStyle: data.italic ? 'italic' : 'normal',
            letterSpacing: 'normal',
          }}
        />
      </div>

      {selected && (
        <button
          onClick={() => data.onSpawn(id)}
          title="დაკავშირებული ფურცლის დამატება"
          className="absolute -right-3.5 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 translate-x-full items-center justify-center rounded-full bg-emerald-600 text-white shadow-md transition-colors hover:bg-emerald-500"
        >
          <Plus size={15} />
        </button>
      )}
    </div>
  )
}

const nodeTypes = { sticky: StickyNoteNode }

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 18, height: 18 },
  style: { stroke: '#94a3b8', strokeWidth: 2 },
}

// Stored board shape (what lands in boards.data as JSONB).
export type BoardData = {
  nodes: {
    id: string
    position: { x: number; y: number }
    width?: number
    height?: number
    text: string
    bold?: boolean
    italic?: boolean
    fontSize?: number
  }[]
  edges: { id: string; source: string; target: string }[]
}

let nodeSeq = 0
const newId = () => `n${Date.now().toString(36)}${(nodeSeq++).toString(36)}`

// ---------------------------------------------------------------------------

function BoardCanvas({
  boardId,
  initialName,
  initialData,
}: {
  boardId: string
  initialName: string
  initialData: BoardData
}) {
  const router = useRouter()
  const { screenToFlowPosition } = useReactFlow()
  const [name, setName] = useState(initialName)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Callbacks the sticky nodes call back into; defined before node init so
  // the initial nodes can carry them.
  const onTextChange = useCallback((id: string, text: string) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle bold/italic or bump font size on a single note.
  const onFormat = useCallback((id: string, patch: Formatting) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onSpawn = useCallback((id: string) => {
    setNodes((ns) => {
      const parent = ns.find((n) => n.id === id)
      if (!parent) return ns
      const childId = newId()
      const child: StickyNode = {
        id: childId,
        type: 'sticky',
        position: {
          x: parent.position.x + (parent.width ?? 180) + 90,
          y: parent.position.y,
        },
        width: 180,
        height: 100,
        data: { text: '', onChange: onTextChange, onSpawn, onFormat },
      }
      setEdges((es) =>
        addEdge(
          { id: `e${id}-${childId}`, source: id, target: childId, ...defaultEdgeOptions },
          es
        )
      )
      return [...ns, child]
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const initialNodes: StickyNode[] = useMemo(
    () =>
      initialData.nodes.map((n) => ({
        id: n.id,
        type: 'sticky' as const,
        position: n.position,
        width: n.width ?? 180,
        height: n.height ?? 100,
        data: {
          text: n.text,
          bold: n.bold,
          italic: n.italic,
          fontSize: n.fontSize,
          onChange: onTextChange,
          onSpawn,
          onFormat,
        },
      })),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const initialEdges: Edge[] = useMemo(
    () => initialData.edges.map((e) => ({ ...e, ...defaultEdgeOptions })),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, ...defaultEdgeOptions }, es)),
    [setEdges]
  )

  // Double-click on empty canvas → new note there. (Guard: double-clicks
  // inside a note/edge/control must not spawn one.)
  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains('react-flow__pane'))
        return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const node: StickyNode = {
        id: newId(),
        type: 'sticky',
        position: { x: pos.x - 90, y: pos.y - 50 },
        width: 180,
        height: 100,
        data: { text: '', onChange: onTextChange, onSpawn, onFormat },
      }
      setNodes((ns) => [...ns, node])
    },
    [screenToFlowPosition, onTextChange, onSpawn, onFormat, setNodes]
  )

  function addNoteCenter() {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    const node: StickyNode = {
      id: newId(),
      type: 'sticky',
      position: { x: pos.x - 90, y: pos.y - 50 },
      width: 180,
      height: 100,
      data: { text: '', onChange: onTextChange, onSpawn, onFormat },
    }
    setNodes((ns) => [...ns, node])
  }

  function deleteSelected() {
    setNodes((ns) => ns.filter((n) => !n.selected))
    setEdges((es) => {
      const gone = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      return es.filter(
        (e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)
      )
    })
  }

  // ---- debounced autosave: any nodes/edges/name change → PATCH in 1.2s ----
  const serialize = useCallback((): BoardData => {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        width: n.width,
        height: n.height,
        text: (n.data as StickyData).text,
        bold: (n.data as StickyData).bold,
        italic: (n.data as StickyData).italic,
        fontSize: (n.data as StickyData).fontSize,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    }
  }, [nodes, edges])

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setSaveState('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        const res = await fetch('/api/boards', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: boardId, name, data: serialize() }),
        })
        setSaveState(res.ok ? 'saved' : 'error')
      } catch {
        setSaveState('error')
      }
    }, 1200)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, name])

  async function deleteBoard() {
    if (!window.confirm(`წაიშალოს დაფა "${name}"?`)) return
    const res = await fetch('/api/boards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: boardId }),
    })
    if (res.ok) router.push('/boards')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Link
          href="/boards"
          className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
        >
          <ArrowLeft size={15} /> დაფები
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-100 focus:border-slate-700 focus:bg-slate-800 focus:outline-none"
        />
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          {saveState === 'saving' && (
            <>
              <Loader2 size={12} className="animate-spin" /> ინახება…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check size={12} className="text-emerald-500" /> შენახულია
            </>
          )}
          {saveState === 'dirty' && '…'}
          {saveState === 'error' && (
            <span className="text-red-400">⚠️ ვერ შეინახა</span>
          )}
        </span>
        <button
          onClick={addNoteCenter}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus size={14} /> ფურცელი
        </button>
        <button
          onClick={deleteSelected}
          title="მონიშნულის წაშლა (Delete)"
          className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={deleteBoard}
          className="text-[11px] text-slate-600 transition-colors hover:text-red-400"
        >
          დაფის წაშლა
        </button>
      </div>

      {/* Canvas */}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDoubleClick={onPaneDoubleClick}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          deleteKeyCode={['Delete', 'Backspace']}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-950"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.5}
            color="#1e293b"
          />
          <Controls
            showInteractive={false}
            className="!rounded-lg !border !border-slate-700 !bg-slate-800 !shadow-lg [&>button]:!border-slate-700 [&>button]:!bg-slate-800 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-700"
          />
        </ReactFlow>
      </div>

      {/* Hint */}
      <div className="shrink-0 border-t border-slate-800 px-4 py-1.5 text-center text-[11px] text-slate-600">
        ორმაგი კლიკი — ახალი ფურცელი · მონიშნულზე ➕ — დაკავშირებული ფურცელი · გვერდის წრეებიდან გაათრიე ისარი · Delete — წაშლა
      </div>
    </div>
  )
}

export default function StrategyBoard(props: {
  boardId: string
  initialName: string
  initialData: BoardData
}) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  )
}
