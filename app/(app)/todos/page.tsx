'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where } from '@/lib/firebase/db'

interface Todo {
  id: string
  title: string
  category: 'personal' | 'work'
  priority: 1 | 2 | 3
  dueDate?: string
  completed: boolean
  completedAt?: string
  linkedGoalId?: string
  createdAt: string
}

function TodosContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const today = todayDate()

  const [tab, setTab] = useState<'personal' | 'work'>((searchParams.get('tab') as 'personal' | 'work') ?? 'personal')
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editPriority, setEditPriority] = useState<1 | 2 | 3>(2)
  const [editDueDate, setEditDueDate] = useState('')

  // New todo form
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2)
  const [newDueDate, setNewDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!user) return
    loadTodos()
  }, [user])

  async function loadTodos() {
    if (!user) return
    const docs = await queryDocuments('todos', [
      where('userId', '==', user.uid),
    ])
    setTodos(docs.map(d => ({
      id: d.id,
      title: d.title,
      category: d.category ?? 'personal',
      priority: d.priority ?? 2,
      dueDate: d.dueDate,
      completed: d.completed ?? false,
      completedAt: d.completedAt,
      linkedGoalId: d.linkedGoalId,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setLoading(false)
  }

  async function addTodo() {
    if (!user || !newTitle.trim()) return
    setAdding(true)
    await addDocument('todos', {
      userId: user.uid,
      title: newTitle.trim(),
      category: tab,
      priority: newPriority,
      dueDate: newDueDate || null,
      completed: false,
      createdAt: new Date().toISOString(),
    })
    setNewTitle('')
    setNewPriority(2)
    setNewDueDate('')
    setShowAdd(false)
    setAdding(false)
    await loadTodos()
  }

  async function toggleTodo(todo: Todo) {
    if (!user) return
    const newCompleted = !todo.completed
    await updateDocument('todos', todo.id, {
      completed: newCompleted,
      completedAt: newCompleted ? new Date().toISOString() : null,
    })
    if (newCompleted) {
      // Award XP
      await addDocument('xp_events', {
        userId: user.uid,
        date: today,
        eventType: 'todo',
        xpEarned: 10,
        description: `Completed todo: ${todo.title}`,
      })
    }
    setTodos(prev => prev.map(t => t.id === todo.id
      ? { ...t, completed: newCompleted, completedAt: newCompleted ? new Date().toISOString() : undefined }
      : t
    ))
  }

  async function deleteTodo(id: string) {
    await deleteDocument('todos', id)
    setTodos(prev => prev.filter(t => t.id !== id))
    setMenuId(null)
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.id)
    setEditTitle(todo.title)
    setEditPriority(todo.priority)
    setEditDueDate(todo.dueDate ?? '')
    setMenuId(null)
  }

  async function saveEdit() {
    if (!editingId || !editTitle.trim()) return
    await updateDocument('todos', editingId, {
      title: editTitle.trim(),
      priority: editPriority,
      dueDate: editDueDate || null,
    })
    setTodos(prev => prev.map(t => t.id === editingId
      ? { ...t, title: editTitle.trim(), priority: editPriority, dueDate: editDueDate || undefined }
      : t
    ))
    setEditingId(null)
  }

  const filteredTodos = todos.filter(t => t.category === tab)
  const pendingTodos = filteredTodos.filter(t => !t.completed)
  const completedTodos = filteredTodos.filter(t => t.completed)

  // Sort: P1 first, then P2, then P3; within each priority overdue first
  const sortedPending = [...pendingTodos].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const aOverdue = a.dueDate && a.dueDate < today ? -1 : 0
    const bOverdue = b.dueDate && b.dueDate < today ? -1 : 0
    return aOverdue - bOverdue
  })

  const p1Count = pendingTodos.filter(t => t.priority === 1).length
  const overdueCount = pendingTodos.filter(t => t.dueDate && t.dueDate < today).length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">📋</div>
          <p className="text-sm text-muted">Loading todos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats row */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{pendingTodos.length}</p>
          <p className="text-xs text-muted">Open</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: p1Count > 0 ? '#ef4444' : 'var(--muted)' }}>{p1Count}</p>
          <p className="text-xs text-muted">P1 today</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: overdueCount > 0 ? '#f59e0b' : 'var(--muted)' }}>{overdueCount}</p>
          <p className="text-xs text-muted">Overdue</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl p-1" style={{ background: 'var(--surface)' }}>
        {(['personal', 'work'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors capitalize"
            style={{
              background: tab === t ? '#14b8a6' : 'transparent',
              color: tab === t ? 'white' : 'var(--muted)',
            }}
          >
            {t === 'personal' ? '👤' : '💼'} {t}
          </button>
        ))}
      </div>

      {/* Add todo form */}
      {showAdd ? (
        <div className="card space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            onKeyDown={e => e.key === 'Enter' && addTodo()}
            autoFocus
          />
          <div className="flex gap-2">
            <div className="flex gap-1">
              {([1, 2, 3] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${newPriority === p ? (p === 1 ? 'badge-p1' : p === 2 ? 'badge-p2' : 'bg-gray-200 text-gray-600') : 'text-muted'}`}
                  style={newPriority !== p ? { background: 'var(--surface-2)', border: '1px solid var(--border)' } : {}}
                >
                  P{p}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={newDueDate}
              onChange={e => setNewDueDate(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
            >
              Cancel
            </button>
            <button
              onClick={addTodo}
              disabled={!newTitle.trim() || adding}
              className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}
            >
              {adding ? '...' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}
        >
          <span className="text-lg">+</span> Add {tab} todo
        </button>
      )}

      {/* Todo list */}
      {sortedPending.length === 0 && (
        <div className="text-center py-8">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm text-muted">All caught up!</p>
        </div>
      )}

      <div className="space-y-2">
        {sortedPending.map(todo => {
          const isOverdue = todo.dueDate && todo.dueDate < today
          if (editingId === todo.id) {
            return (
              <div key={todo.id} className="card space-y-2">
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  onKeyDown={e => e.key === 'Enter' && saveEdit()} autoFocus />
                <div className="flex gap-2">
                  {([1, 2, 3] as const).map(p => (
                    <button key={p} onClick={() => setEditPriority(p)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                      style={{
                        background: editPriority === p ? (p === 1 ? 'rgba(239,68,68,0.15)' : p === 2 ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)') : 'var(--surface-2)',
                        color: editPriority === p ? (p === 1 ? '#ef4444' : p === 2 ? '#f59e0b' : '#6b7280') : 'var(--muted)',
                        border: '1px solid var(--border)',
                      }}>P{p}</button>
                  ))}
                  <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="flex-1 py-2 rounded-xl text-xs"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
                  <button onClick={saveEdit} className="flex-1 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: '#14b8a6', color: 'white' }}>Save</button>
                </div>
              </div>
            )
          }
          return (
            <TodoItem
              key={todo.id}
              todo={todo}
              today={today}
              isOverdue={!!isOverdue}
              menuOpen={menuId === todo.id}
              onToggle={() => toggleTodo(todo)}
              onMenu={() => setMenuId(menuId === todo.id ? null : todo.id)}
              onEdit={() => startEdit(todo)}
              onDelete={() => deleteTodo(todo.id)}
            />
          )
        })}
      </div>

      {/* Completed section */}
      {completedTodos.length > 0 && (
        <div>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-2 text-xs text-muted mb-2"
          >
            <span>{showCompleted ? '▼' : '▶'}</span>
            Completed ({completedTodos.length})
          </button>
          {showCompleted && (
            <div className="space-y-2 opacity-60">
              {completedTodos.slice(0, 10).map(todo => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  today={today}
                  isOverdue={false}
                  menuOpen={false}
                  onToggle={() => toggleTodo(todo)}
                  onMenu={() => {}}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

function TodoItem({ todo, today, isOverdue, menuOpen, onToggle, onMenu, onEdit, onDelete }: {
  todo: Todo
  today: string
  isOverdue: boolean
  menuOpen: boolean
  onToggle: () => void
  onMenu: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const priorityColors: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#6b7280' }

  return (
    <div
      className="px-3 py-2.5 rounded-xl"
      style={{
        background: todo.completed ? 'var(--surface-2)' : (isOverdue ? 'rgba(239,68,68,0.05)' : 'var(--surface)'),
        border: todo.completed ? '1px solid var(--border)' : (isOverdue ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)'),
      }}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
          style={{
            background: todo.completed ? '#22c55e' : 'transparent',
            border: todo.completed ? 'none' : `2px solid ${priorityColors[todo.priority]}`,
          }}
        >
          {todo.completed && <span className="text-white text-xs">✓</span>}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug"
            style={{ textDecoration: todo.completed ? 'line-through' : 'none', color: todo.completed ? 'var(--muted)' : 'var(--foreground)' }}>
            {todo.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold" style={{ color: priorityColors[todo.priority] }}>P{todo.priority}</span>
            {todo.dueDate && (
              <span className="text-[10px]" style={{ color: isOverdue ? '#ef4444' : 'var(--muted)' }}>
                {isOverdue ? '⚠️ ' : ''}{new Date(todo.dueDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            )}
            {todo.completed && <span className="text-[10px]" style={{ color: '#22c55e' }}>+10 XP</span>}
          </div>
        </div>
        {!todo.completed && (
          <button onClick={onMenu} className="text-muted text-base px-1 flex-shrink-0">⋯</button>
        )}
      </div>
      {menuOpen && (
        <div className="flex gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onEdit} className="flex-1 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
          <button onClick={onDelete} className="flex-1 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🗑️ Delete</button>
        </div>
      )}
    </div>
  )
}

export default function TodosPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    }>
      <TodosContent />
    </Suspense>
  )
}
