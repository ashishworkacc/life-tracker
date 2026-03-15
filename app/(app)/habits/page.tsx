'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface Habit {
  id: string
  name: string
  emoji?: string
  priority: 1 | 2 | 3
  isActive: boolean
  isCoreHabit: boolean
  currentStreak: number
  bestStreak: number
  completionRate7d: number
  level1Threshold?: number
  level1Description?: string
}

export default function HabitsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [habits, setHabits] = useState<Habit[]>([])
  const [todayLogs, setTodayLogs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmoji, setEditEmoji] = useState('')
  const [editPriority, setEditPriority] = useState<1 | 2 | 3>(2)
  const [editIsCore, setEditIsCore] = useState(false)

  // New habit form
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2)
  const [newIsCore, setNewIsCore] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    loadHabits()
  }, [user])

  async function loadHabits() {
    if (!user) return

    const [habitDocs, logs] = await Promise.all([
      queryDocuments('habits', [
        where('userId', '==', user.uid),
        where('isActive', '==', true),
        orderBy('priority', 'asc'),
      ]),
      queryDocuments('daily_habit_logs', [
        where('userId', '==', user.uid),
        where('date', '==', today),
      ]),
    ])

    const doneSet = new Set(logs.filter(l => l.completed).map(l => l.habitId as string))
    setTodayLogs(doneSet)

    // Calculate streaks from last 30 days logs
    const last30 = await queryDocuments('daily_habit_logs', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
    ])

    setHabits(habitDocs.map(h => {
      const habitLogs = last30.filter(l => l.habitId === h.id)
      const datesDone = new Set(habitLogs.filter(l => l.completed).map(l => l.date as string))

      // Calculate current streak
      let streak = 0
      for (let i = 0; i <= 30; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const ds = d.toISOString().split('T')[0]
        if (datesDone.has(ds)) streak++
        else break
      }

      // Completion rate last 7 days
      let done7 = 0
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const ds = d.toISOString().split('T')[0]
        if (datesDone.has(ds)) done7++
      }

      return {
        id: h.id,
        name: h.name,
        emoji: h.emoji,
        priority: h.priority ?? 2,
        isActive: h.isActive ?? true,
        isCoreHabit: h.isCoreHabit ?? false,
        currentStreak: streak,
        bestStreak: h.bestStreak ?? streak,
        completionRate7d: Math.round((done7 / 7) * 100),
        level1Threshold: h.level1Threshold,
        level1Description: h.level1Description,
      }
    }))

    setLoading(false)
  }

  async function toggleHabit(habit: Habit) {
    if (!user) return
    const newDone = new Set(todayLogs)
    const isDone = newDone.has(habit.id)

    if (isDone) {
      newDone.delete(habit.id)
    } else {
      newDone.add(habit.id)
      await addDocument('xp_events', {
        userId: user.uid, date: today,
        eventType: 'habit', xpEarned: 10,
        description: `Completed habit: ${habit.name}`,
      })
    }
    setTodayLogs(newDone)

    await addDocument('daily_habit_logs', {
      userId: user.uid, date: today,
      habitId: habit.id,
      completed: !isDone,
      completedAt: new Date().toISOString(),
    })
  }

  async function saveHabit() {
    if (!user || !newName.trim()) return
    setSaving(true)
    await addDocument('habits', {
      userId: user.uid,
      name: newName.trim(),
      emoji: newEmoji || null,
      priority: newPriority,
      isActive: true,
      isCoreHabit: newIsCore,
      bestStreak: 0,
    })
    setNewName('')
    setNewEmoji('')
    setNewPriority(2)
    setNewIsCore(false)
    setShowAdd(false)
    setSaving(false)
    await loadHabits()
  }

  async function archiveHabit(habitId: string) {
    await updateDocument('habits', habitId, { isActive: false })
    setHabits(prev => prev.filter(h => h.id !== habitId))
  }

  function startEditHabit(habit: Habit) {
    setEditingHabit(habit)
    setEditName(habit.name)
    setEditEmoji(habit.emoji ?? '')
    setEditPriority(habit.priority)
    setEditIsCore(habit.isCoreHabit)
    setEditId(null)
  }

  async function saveHabitEdit() {
    if (!editingHabit || !editName.trim()) return
    await updateDocument('habits', editingHabit.id, {
      name: editName.trim(),
      emoji: editEmoji || null,
      priority: editPriority,
      isCoreHabit: editIsCore,
    })
    setHabits(prev => prev.map(h => h.id === editingHabit.id
      ? { ...h, name: editName.trim(), emoji: editEmoji || undefined, priority: editPriority, isCoreHabit: editIsCore }
      : h
    ))
    setEditingHabit(null)
  }

  const priorityLabel: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted">Loading habits...</p>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Summary bar */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#22c55e' }}>{todayLogs.size}</p>
          <p className="text-xs text-muted">Done today</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{habits.length}</p>
          <p className="text-xs text-muted">Active habits</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
            {Math.max(...habits.map(h => h.currentStreak), 0)}
          </p>
          <p className="text-xs text-muted">Best streak</p>
        </div>
      </div>

      {/* Add habit */}
      {showAdd ? (
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">New Habit</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newEmoji}
              onChange={e => setNewEmoji(e.target.value)}
              placeholder="🎯"
              className="w-12 text-center px-2 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              maxLength={2}
            />
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Habit name"
              className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              onKeyDown={e => e.key === 'Enter' && saveHabit()}
              autoFocus
            />
          </div>

          {/* Priority */}
          <div className="flex gap-2">
            {([1, 2, 3] as const).map(p => (
              <button
                key={p}
                onClick={() => setNewPriority(p)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors`}
                style={{
                  background: newPriority === p
                    ? (p === 1 ? 'rgba(239,68,68,0.15)' : p === 2 ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)')
                    : 'var(--surface-2)',
                  border: newPriority === p
                    ? `1px solid ${p === 1 ? '#ef4444' : p === 2 ? '#f59e0b' : '#6b7280'}`
                    : '1px solid var(--border)',
                  color: newPriority === p
                    ? (p === 1 ? '#ef4444' : p === 2 ? '#f59e0b' : '#6b7280')
                    : 'var(--muted)',
                }}
              >
                P{p} — {p === 1 ? 'Must do' : p === 2 ? 'Should do' : 'Nice to do'}
              </button>
            ))}
          </div>

          {/* Core habit toggle */}
          <button
            onClick={() => setNewIsCore(!newIsCore)}
            className="flex items-center gap-2 text-sm"
            style={{ color: newIsCore ? '#14b8a6' : 'var(--muted)' }}
          >
            <span className={`w-5 h-5 rounded flex items-center justify-center text-xs`}
              style={{ background: newIsCore ? '#14b8a6' : 'var(--surface-2)', border: `1px solid ${newIsCore ? '#14b8a6' : 'var(--border)'}`, color: 'white' }}>
              {newIsCore ? '✓' : ''}
            </span>
            Core habit (shown in Burnout Mode)
          </button>

          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)}
              className="flex-1 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
              Cancel
            </button>
            <button onClick={saveHabit} disabled={!newName.trim() || saving}
              className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>
              {saving ? '...' : 'Save habit'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
          <span className="text-lg">+</span> Add new habit
        </button>
      )}

      {/* Habits list */}
      {habits.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-sm text-muted">No habits yet. Add your first!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {habits.map(habit => {
            const done = todayLogs.has(habit.id)
            const atRisk = habit.currentStreak > 0 && !done
            const priorityColor = habit.priority === 1 ? '#ef4444' : habit.priority === 2 ? '#f59e0b' : '#6b7280'

            return (
              <div key={habit.id} className="card"
                style={{
                  border: done ? '1px solid rgba(34,197,94,0.3)' : atRisk ? '1px solid rgba(245,158,11,0.3)' : '1px solid var(--border)',
                }}>
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleHabit(habit)}
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background: done ? '#22c55e' : 'transparent',
                      border: done ? 'none' : `2px solid ${priorityColor}`,
                    }}
                  >
                    {done && <span className="text-white text-xs font-bold">✓</span>}
                  </button>

                  {/* Name */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      {habit.emoji && <span>{habit.emoji}</span>}
                      <span className="font-medium text-sm"
                        style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--muted)' : 'var(--foreground)' }}>
                        {habit.name}
                      </span>
                      {habit.isCoreHabit && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>core</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold" style={{ color: priorityColor }}>
                        {priorityLabel[habit.priority]}
                      </span>
                      {habit.currentStreak > 0 && (
                        <span className="text-[10px] text-muted">
                          🔥 {habit.currentStreak} day streak
                        </span>
                      )}
                      <span className="text-[10px] text-muted">
                        {habit.completionRate7d}% this week
                      </span>
                      {atRisk && (
                        <span className="text-[10px]" style={{ color: '#f59e0b' }}>⚠️ streak at risk</span>
                      )}
                    </div>
                  </div>

                  <button onClick={() => setEditId(editId === habit.id ? null : habit.id)} className="text-muted text-sm px-1">⋯</button>
                </div>

                {/* Progress bar — completion rate */}
                <div className="mt-2 w-full rounded-full h-1 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${habit.completionRate7d}%`, background: done ? '#22c55e' : '#14b8a6' }} />
                </div>

                {editId === habit.id && editingHabit?.id !== habit.id && (
                  <div className="flex gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => startEditHabit(habit)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                    <button onClick={() => archiveHabit(habit.id)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>📦 Archive</button>
                  </div>
                )}

                {editingHabit?.id === habit.id && (
                  <div className="mt-2 pt-2 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex gap-2">
                      <input value={editEmoji} onChange={e => setEditEmoji(e.target.value)}
                        className="w-10 text-center px-2 py-1.5 rounded-xl text-sm outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }} maxLength={2} />
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-xl text-sm outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} autoFocus />
                    </div>
                    <div className="flex gap-1">
                      {([1, 2, 3] as const).map(p => (
                        <button key={p} onClick={() => setEditPriority(p)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                          style={{
                            background: editPriority === p ? (p === 1 ? 'rgba(239,68,68,0.15)' : p === 2 ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)') : 'var(--surface-2)',
                            color: editPriority === p ? (p === 1 ? '#ef4444' : p === 2 ? '#f59e0b' : '#6b7280') : 'var(--muted)',
                            border: '1px solid var(--border)',
                          }}>P{p}</button>
                      ))}
                    </div>
                    <button onClick={() => setEditIsCore(!editIsCore)}
                      className="flex items-center gap-2 text-xs"
                      style={{ color: editIsCore ? '#14b8a6' : 'var(--muted)' }}>
                      <span className="w-4 h-4 rounded flex items-center justify-center"
                        style={{ background: editIsCore ? '#14b8a6' : 'var(--surface-2)', border: `1px solid ${editIsCore ? '#14b8a6' : 'var(--border)'}`, color: 'white', fontSize: 10 }}>
                        {editIsCore ? '✓' : ''}
                      </span>
                      Core habit
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingHabit(null)} className="flex-1 py-1.5 rounded-xl text-xs"
                        style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
                      <button onClick={saveHabitEdit} className="flex-1 py-1.5 rounded-xl text-xs font-semibold"
                        style={{ background: '#14b8a6', color: 'white' }}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
