'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where } from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'

interface SubTask {
  id: string
  title: string
  done: boolean
  source?: 'ai' | 'manual'  // 'ai' = AI-generated; 'manual' = user-added
}

interface Todo {
  id: string
  title: string
  description: string
  category: 'personal' | 'work'
  tag: string
  priority: 1 | 2 | 3
  dueDate?: string
  completed: boolean
  completedAt?: string
  subTasks: SubTask[]
  linkedGoalId?: string
  createdAt: string
}

const PRIORITY_COLOR: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#6b7280' }
const PRIORITY_BG: Record<number, string> = { 1: 'rgba(239,68,68,0.12)', 2: 'rgba(245,158,11,0.12)', 3: 'rgba(107,114,128,0.12)' }
const TAGS = ['🏠 Home', '💪 Health', '💰 Finance', '👨‍👩‍👧 Family', '📚 Learning', '🚀 Side Project', '📋 Admin', '🤝 Meeting', '⚡ Urgent', '🎯 Project']

function TodosContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const today = todayDate()

  const [tab, setTab] = useState<'personal' | 'work'>((searchParams.get('tab') as 'personal' | 'work') ?? 'personal')
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [showCompleted, setShowCompleted] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newTag, setNewTag] = useState('')
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2)
  const [newDueDate, setNewDueDate] = useState('')
  const [newSubTasks, setNewSubTasks] = useState<SubTask[]>([])
  const [newSubInput, setNewSubInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [breakdownLoading, setBreakdownLoading] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editTag, setEditTag] = useState('')
  const [editPriority, setEditPriority] = useState<1 | 2 | 3>(2)
  const [editDueDate, setEditDueDate] = useState('')
  const [editBreakdownLoading, setEditBreakdownLoading] = useState(false)
  const [editSubInput, setEditSubInput] = useState('')

  useEffect(() => { if (!user) return; loadTodos() }, [user])

  async function loadTodos() {
    if (!user) return
    try {
      const docs = await queryDocuments('todos', [where('userId', '==', user.uid)])
      setTodos(docs.map(d => ({
        id: d.id, title: d.title, description: d.description ?? '',
        category: d.category ?? 'personal', tag: d.tag ?? '',
        priority: d.priority ?? 2, dueDate: d.dueDate,
        completed: d.completed ?? false, completedAt: d.completedAt,
        subTasks: (d.subTasks ?? []) as SubTask[], linkedGoalId: d.linkedGoalId,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
      })).sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.createdAt.localeCompare(a.createdAt)))
    } catch (err) { console.error('loadTodos:', err) }
    finally { setLoading(false) }
  }

  async function fetchBreakdown(title: string, isEdit: boolean, todoId?: string) {
    if (!title.trim() || !user) return
    isEdit ? setEditBreakdownLoading(true) : setBreakdownLoading(true)
    try {
      const res = await fetch('/api/ai/breakdown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: title.trim(), userId: user.uid }),
      })
      const data = await res.json()
      const steps: SubTask[] = (data.steps ?? []).map((s: any, i: number) => ({
        id: `st-${Date.now()}-${i}`,
        title: typeof s === 'string' ? s : s.title ?? String(s),
        done: false,
        source: 'ai' as const,
      }))
      if (isEdit && todoId) {
        const todo = todos.find(t => t.id === todoId)
        // Keep manually-added subtasks; replace all AI-generated ones with the new batch
        const manualSubTasks = (todo?.subTasks ?? []).filter(e => e.source === 'manual')
        const merged = [...manualSubTasks, ...steps]
        await updateDocument('todos', todoId, { subTasks: merged })
        setTodos(prev => prev.map(t => t.id === todoId ? { ...t, subTasks: merged } : t))
      } else {
        setNewSubTasks(steps)
      }
    } catch { /* ignore */ }
    isEdit ? setEditBreakdownLoading(false) : setBreakdownLoading(false)
  }

  async function addTodo() {
    if (!user || !newTitle.trim()) return
    setAdding(true)
    await addDocument('todos', {
      userId: user.uid, title: newTitle.trim(), description: newDesc.trim(),
      category: tab, tag: newTag, priority: newPriority,
      dueDate: newDueDate || null, completed: false,
      subTasks: newSubTasks, createdAt: new Date().toISOString(),
    })
    setNewTitle(''); setNewDesc(''); setNewTag(''); setNewPriority(2); setNewDueDate(''); setNewSubTasks([])
    setShowAdd(false); setAdding(false)
    await loadTodos()
  }

  async function toggleTodo(todo: Todo) {
    if (!user) return
    const newCompleted = !todo.completed
    await updateDocument('todos', todo.id, { completed: newCompleted, completedAt: newCompleted ? new Date().toISOString() : null })
    if (newCompleted) {
      await addDocument('xp_events', { userId: user.uid, date: today, eventType: 'todo', xpEarned: 10, description: `Completed todo: ${todo.title}` })
      const xpDocs = await queryDocuments('user_xp', [where('userId', '==', user.uid)])
      if (xpDocs.length > 0) await updateDocument('user_xp', xpDocs[0].id, { xpTotal: (xpDocs[0].xpTotal ?? 0) + 10 })
      else await addDocument('user_xp', { userId: user.uid, xpTotal: 10, level: 1 })
    } else {
      // Reverse XP
      const evts = await queryDocuments('xp_events', [
        where('userId', '==', user.uid), where('date', '==', today), where('eventType', '==', 'todo'),
      ])
      const evt = (evts as DocumentData[]).find(e => e.description?.includes(todo.title))
      if (evt) await deleteDocument('xp_events', evt.id)
      const xpDocs = await queryDocuments('user_xp', [where('userId', '==', user.uid)])
      if (xpDocs.length > 0) await updateDocument('user_xp', xpDocs[0].id, { xpTotal: Math.max(0, (xpDocs[0].xpTotal ?? 0) - 10) })
    }
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: newCompleted, completedAt: newCompleted ? new Date().toISOString() : undefined } : t))
  }

  async function toggleSubTask(todo: Todo, subId: string) {
    const updated = todo.subTasks.map(s => s.id === subId ? { ...s, done: !s.done } : s)
    await updateDocument('todos', todo.id, { subTasks: updated })
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, subTasks: updated } : t))
  }

  async function deleteTodo(id: string) {
    await deleteDocument('todos', id)
    setTodos(prev => prev.filter(t => t.id !== id)); setMenuId(null)
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.id); setEditTitle(todo.title); setEditDesc(todo.description)
    setEditTag(todo.tag); setEditPriority(todo.priority); setEditDueDate(todo.dueDate ?? '')
    setMenuId(null); setExpandedId(todo.id)
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) return
    await updateDocument('todos', editingId, { title: editTitle.trim(), description: editDesc.trim(), tag: editTag, priority: editPriority, dueDate: editDueDate || null })
    setTodos(prev => prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim(), description: editDesc.trim(), tag: editTag, priority: editPriority, dueDate: editDueDate || undefined } : t)
      .sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.createdAt.localeCompare(a.createdAt)))
    setEditingId(null)
  }

  const filteredTodos = todos.filter(t => t.category === tab)
  const pendingTodos = filteredTodos.filter(t => !t.completed)
  const completedTodos = filteredTodos.filter(t => t.completed)
  const p1 = pendingTodos.filter(t => t.priority === 1)
  const p2 = pendingTodos.filter(t => t.priority === 2)
  const p3 = pendingTodos.filter(t => t.priority === 3)
  const groups = [
    { label: 'P1 · Must do', color: '#ef4444', items: p1 },
    { label: 'P2 · Should do', color: '#f59e0b', items: p2 },
    { label: 'P3 · Nice to do', color: '#6b7280', items: p3 },
  ].filter(g => g.items.length > 0)

  const p1Count = p1.length
  const overdueCount = pendingTodos.filter(t => t.dueDate && t.dueDate < today).length

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center"><div className="text-4xl mb-3 animate-pulse">📋</div><p className="text-sm text-muted">Loading...</p></div>
    </div>
  )

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#14b8a6' }}>{pendingTodos.length}</p>
          <p className="text-[10px] text-muted">Open</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: p1Count > 0 ? '#ef4444' : 'var(--muted)' }}>{p1Count}</p>
          <p className="text-[10px] text-muted">P1 urgent</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: overdueCount > 0 ? '#f59e0b' : 'var(--muted)' }}>{overdueCount}</p>
          <p className="text-[10px] text-muted">Overdue</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl p-1" style={{ background: 'var(--surface)' }}>
        {(['personal', 'work'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-sm font-medium capitalize"
            style={{ background: tab === t ? '#14b8a6' : 'transparent', color: tab === t ? 'white' : 'var(--muted)' }}>
            {t === 'personal' ? '👤 Personal' : '💼 Work'}
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAdd ? (
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">✨ New {tab === 'personal' ? 'Personal' : 'Work'} Todo</h3>

          <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to be done?" autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />

          <div>
            <label className="text-xs text-muted mb-1 block">💡 Why do you want to do this?</label>
            <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="e.g. To get the promotion, to feel lighter…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1.5 block">🏷️ Tag</label>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map(t => (
                <button key={t} onClick={() => setNewTag(newTag === t ? '' : t)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{
                    background: newTag === t ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                    border: newTag === t ? '1px solid #14b8a6' : '1px solid var(--border)',
                    color: newTag === t ? '#14b8a6' : 'var(--muted)',
                  }}>{t}</button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <div className="flex gap-1">
              {([1, 2, 3] as const).map(p => (
                <button key={p} onClick={() => setNewPriority(p)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold"
                  style={{
                    background: newPriority === p ? PRIORITY_BG[p] : 'var(--surface-2)',
                    border: newPriority === p ? `1px solid ${PRIORITY_COLOR[p]}` : '1px solid var(--border)',
                    color: newPriority === p ? PRIORITY_COLOR[p] : 'var(--muted)',
                  }}>P{p}</button>
              ))}
            </div>
            <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
          </div>

          {/* Sub-tasks: manual add */}
          <div>
            <label className="text-xs text-muted mb-1.5 block">🧩 Sub-tasks</label>
            <div className="flex gap-2">
              <input value={newSubInput} onChange={e => setNewSubInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newSubInput.trim()) {
                    setNewSubTasks(prev => [...prev, { id: `st-${Date.now()}`, title: newSubInput.trim(), done: false, source: 'manual' }])
                    setNewSubInput('')
                    e.preventDefault()
                  }
                }}
                placeholder="Add a sub-task (Enter to add)…"
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <button onClick={() => {
                if (!newSubInput.trim()) return
                setNewSubTasks(prev => [...prev, { id: `st-${Date.now()}`, title: newSubInput.trim(), done: false, source: 'manual' }])
                setNewSubInput('')
              }} className="px-3 py-2 rounded-xl text-sm font-semibold"
                style={{ background: '#14b8a6', color: 'white' }}>+</button>
            </div>
          </div>

          <button onClick={() => fetchBreakdown(newTitle, false)}
            disabled={!newTitle.trim() || breakdownLoading}
            className="w-full py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
            {breakdownLoading ? '🤔 Breaking down…' : '🧩 AI: Generate sub-tasks'}
          </button>

          {newSubTasks.length > 0 && (
            <div className="space-y-1.5 pl-3 border-l-2" style={{ borderColor: '#a855f7' }}>
              {newSubTasks.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: s.source === 'manual' ? 'rgba(20,184,166,0.1)' : 'rgba(168,85,247,0.1)', color: s.source === 'manual' ? '#14b8a6' : '#a855f7' }}>{s.source === 'manual' ? 'manual' : 'AI'}</span>
                  <p className="text-xs flex-1">{s.title}</p>
                  <button onClick={() => setNewSubTasks(prev => prev.filter(x => x.id !== s.id))}
                    className="text-[10px]" style={{ color: '#ef4444' }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setNewSubTasks([]) }}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={addTodo} disabled={!newTitle.trim() || adding}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>
              {adding ? '…' : 'Add todo'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
          <span className="text-lg">+</span> Add {tab} todo
        </button>
      )}

      {/* Priority-grouped list */}
      {pendingTodos.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm text-muted">All caught up!</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label}>
              {/* Section header */}
              <div className="flex items-center gap-2 mb-2">
                <div className="h-px flex-1" style={{ background: `${group.color}40` }} />
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                  style={{ background: `${group.color}15`, color: group.color }}>
                  {group.label} · {group.items.length}
                </span>
                <div className="h-px flex-1" style={{ background: `${group.color}40` }} />
              </div>

              <div className="space-y-2">
                {group.items.map(todo => {
                  const isOverdue = !!(todo.dueDate && todo.dueDate < today)
                  const isEditing = editingId === todo.id
                  const isExpanded = expandedId === todo.id
                  const subDone = todo.subTasks.filter(s => s.done).length
                  const pColor = PRIORITY_COLOR[todo.priority]

                  return (
                    <div key={todo.id} className="rounded-xl overflow-hidden"
                      style={{
                        background: isOverdue ? 'rgba(239,68,68,0.04)' : 'var(--surface)',
                        border: isOverdue ? '1px solid rgba(239,68,68,0.25)' : '1px solid var(--border)',
                      }}>

                      {/* Main row */}
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <button onClick={() => toggleTodo(todo)}
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                          style={{ background: 'transparent', border: `2px solid ${pColor}` }} />
                        <div className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : todo.id)}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium leading-snug">{todo.title}</p>
                            {todo.tag && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.2)' }}>
                                {todo.tag}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {todo.dueDate && (
                              <span className="text-[10px]" style={{ color: isOverdue ? '#ef4444' : 'var(--muted)' }}>
                                {isOverdue ? '⚠️ ' : '📅 '}
                                {new Date(todo.dueDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            {todo.subTasks.length > 0 && (
                              <span className="text-[10px] text-muted">🧩 {subDone}/{todo.subTasks.length}</span>
                            )}
                          </div>
                          {todo.subTasks.length > 0 && (
                            <div className="mt-1 w-full rounded-full h-1 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                              <div className="h-full rounded-full" style={{ width: `${(subDone / todo.subTasks.length) * 100}%`, background: '#22c55e' }} />
                            </div>
                          )}
                        </div>
                        <button onClick={() => setMenuId(menuId === todo.id ? null : todo.id)}
                          className="text-muted text-base px-1 flex-shrink-0">⋯</button>
                      </div>

                      {/* Menu */}
                      {menuId === todo.id && !isEditing && (
                        <div className="flex gap-2 px-3 pb-2.5">
                          <button onClick={() => { toggleTodo(todo); setMenuId(null) }}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>✓ Done</button>
                          <button onClick={() => startEdit(todo)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                          <button onClick={() => { fetchBreakdown(todo.title, true, todo.id); setMenuId(null); setExpandedId(todo.id) }}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>🧩 Break</button>
                          <button onClick={() => deleteTodo(todo.id)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🗑️</button>
                        </div>
                      )}

                      {/* Expanded view */}
                      {isExpanded && !isEditing && (
                        <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--border)' }}>
                          {todo.description && (
                            <p className="text-xs text-muted pt-2 italic">💡 {todo.description}</p>
                          )}
                          {todo.subTasks.length > 0 && (
                            <div className="space-y-1.5 pt-2">
                              <p className="text-[10px] text-muted font-semibold uppercase tracking-wide">Sub-tasks</p>
                              {todo.subTasks.map(s => (
                                <div key={s.id} className="flex items-center gap-2">
                                  <button onClick={() => toggleSubTask(todo, s.id)}
                                    className="flex-1 flex items-center gap-2 text-left py-0.5">
                                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                                      style={{ background: s.done ? '#22c55e' : 'transparent', border: s.done ? 'none' : '1.5px solid var(--border)' }}>
                                      {s.done && <span className="text-white text-[9px]">✓</span>}
                                    </span>
                                    <span className="text-xs flex-1"
                                      style={{ textDecoration: s.done ? 'line-through' : 'none', color: s.done ? 'var(--muted)' : 'var(--foreground)' }}>
                                      {s.title}
                                    </span>
                                  </button>
                                  <button onClick={async () => {
                                    const updated = todo.subTasks.filter(st => st.id !== s.id)
                                    await updateDocument('todos', todo.id, { subTasks: updated })
                                    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, subTasks: updated } : t))
                                  }} className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={{ color: 'var(--muted)', background: 'transparent' }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!todo.description && todo.subTasks.length === 0 && (
                            <p className="text-xs text-muted pt-2">Tap ⋯ → 🧩 Break to generate AI sub-tasks.</p>
                          )}
                        </div>
                      )}

                      {/* Inline edit */}
                      {isEditing && (
                        <div className="px-3 pb-3 space-y-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} autoFocus
                            className="w-full px-3 py-2 rounded-xl text-sm outline-none mt-2.5"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                          <div>
                            <label className="text-[10px] text-muted mb-1 block">💡 Why?</label>
                            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Reason / motivation"
                              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {TAGS.map(t => (
                              <button key={t} onClick={() => setEditTag(editTag === t ? '' : t)}
                                className="px-2 py-0.5 rounded-full text-[10px]"
                                style={{
                                  background: editTag === t ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                                  border: editTag === t ? '1px solid #14b8a6' : '1px solid var(--border)',
                                  color: editTag === t ? '#14b8a6' : 'var(--muted)',
                                }}>{t}</button>
                            ))}
                          </div>
                          <div className="flex gap-1.5">
                            {([1, 2, 3] as const).map(p => (
                              <button key={p} onClick={() => setEditPriority(p)}
                                className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                                style={{
                                  background: editPriority === p ? PRIORITY_BG[p] : 'var(--surface-2)',
                                  border: editPriority === p ? `1px solid ${PRIORITY_COLOR[p]}` : '1px solid var(--border)',
                                  color: editPriority === p ? PRIORITY_COLOR[p] : 'var(--muted)',
                                }}>P{p}</button>
                            ))}
                            <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
                          </div>
                          {/* Manual subtask add */}
                          <div className="flex gap-1.5">
                            <input value={editSubInput} onChange={e => setEditSubInput(e.target.value)}
                              onKeyDown={async e => {
                                if (e.key === 'Enter' && editSubInput.trim()) {
                                  const newSub: SubTask = { id: `st-${Date.now()}`, title: editSubInput.trim(), done: false, source: 'manual' }
                                  const updated = [...todo.subTasks, newSub]
                                  await updateDocument('todos', todo.id, { subTasks: updated })
                                  setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, subTasks: updated } : t))
                                  setEditSubInput('')
                                  e.preventDefault()
                                }
                              }}
                              placeholder="Add sub-task (Enter)…"
                              className="flex-1 px-2 py-1.5 rounded-xl text-xs outline-none"
                              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                            <button onClick={async () => {
                              if (!editSubInput.trim()) return
                              const newSub: SubTask = { id: `st-${Date.now()}`, title: editSubInput.trim(), done: false, source: 'manual' }
                              const updated = [...todo.subTasks, newSub]
                              await updateDocument('todos', todo.id, { subTasks: updated })
                              setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, subTasks: updated } : t))
                              setEditSubInput('')
                            }} className="px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                              style={{ background: '#14b8a6', color: 'white' }}>+</button>
                          </div>
                          <button onClick={() => fetchBreakdown(editTitle, true, todo.id)}
                            disabled={!editTitle.trim() || editBreakdownLoading}
                            className="w-full py-1.5 rounded-xl text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
                            style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
                            {editBreakdownLoading ? '🤔 Breaking down…' : '🧩 Regenerate AI sub-tasks (replaces AI ones, keeps manual)'}
                          </button>
                          {todo.subTasks.length > 0 && (
                            <div className="space-y-1 pl-2 border-l-2" style={{ borderColor: '#a855f7' }}>
                              {todo.subTasks.map(s => (
                                <div key={s.id} className="flex items-center gap-1.5">
                                  <span className="text-[8px] px-1 rounded flex-shrink-0" style={{ background: s.source === 'manual' ? 'rgba(20,184,166,0.1)' : 'rgba(168,85,247,0.1)', color: s.source === 'manual' ? '#14b8a6' : '#a855f7' }}>{s.source === 'manual' ? 'm' : 'ai'}</span>
                                  <p className="text-[10px] text-muted flex-1">{s.done ? '✓' : '○'} {s.title}</p>
                                  <button onClick={async () => {
                                    const updated = todo.subTasks.filter(st => st.id !== s.id)
                                    await updateDocument('todos', todo.id, { subTasks: updated })
                                    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, subTasks: updated } : t))
                                  }} className="text-[10px] px-1 py-0.5 rounded flex-shrink-0"
                                    style={{ color: '#ef4444', background: 'transparent' }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => setEditingId(null)}
                              className="flex-1 py-2 rounded-xl text-xs"
                              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
                            <button onClick={saveEdit}
                              className="flex-1 py-2 rounded-xl text-xs font-semibold"
                              style={{ background: '#14b8a6', color: 'white' }}>Save</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed section */}
      {completedTodos.length > 0 && (
        <div>
          <button onClick={() => setShowCompleted(!showCompleted)} className="flex items-center gap-2 text-xs text-muted mb-2">
            <span>{showCompleted ? '▼' : '▶'}</span> Completed ({completedTodos.length})
          </button>
          {showCompleted && (
            <div className="space-y-2 opacity-60">
              {completedTodos.slice(0, 10).map(todo => (
                <div key={todo.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <button onClick={() => toggleTodo(todo)}
                    className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                    style={{ background: '#22c55e' }}>
                    <span className="text-white text-xs">✓</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted" style={{ textDecoration: 'line-through' }}>{todo.title}</p>
                    {todo.tag && <span className="text-[9px] text-muted">{todo.tag}</span>}
                  </div>
                  <span className="text-[10px]" style={{ color: '#22c55e' }}>+10 XP</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TodosPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>}>
      <TodosContent />
    </Suspense>
  )
}
