'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface Habit {
  id: string
  name: string
  emoji: string
  priority: 1 | 2 | 3
  isActive: boolean
  isCoreHabit: boolean
  frequency: 'daily' | 'weekly'
  weekDays: number[]           // 0=Sun … 6=Sat, used when frequency='weekly'
  scheduledTime: 'morning' | 'afternoon' | 'evening' | 'anytime'
  why: string
  currentStreak: number
  bestStreak: number
  completionRate7d: number
  last3Days: (boolean | null)[] // [dayBefore, yesterday, today]
}

const TIME_OPTS = ['morning', 'afternoon', 'evening', 'anytime'] as const
const TIME_ICONS: Record<string, string> = { morning: '🌅', afternoon: '☀️', evening: '🌙', anytime: '⏰' }
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const PRIORITY_COLOR: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#6b7280' }

function getDateStr(daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

export default function HabitsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [habits, setHabits] = useState<Habit[]>([])
  const [todayLogs, setTodayLogs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)

  // ─── Add form state ───
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2)
  const [newIsCore, setNewIsCore] = useState(false)
  const [newFreq, setNewFreq] = useState<'daily' | 'weekly'>('daily')
  const [newWeekDays, setNewWeekDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [newTime, setNewTime] = useState<'morning' | 'afternoon' | 'evening' | 'anytime'>('anytime')
  const [newWhy, setNewWhy] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiEmojiLoading, setAiEmojiLoading] = useState(false)

  // ─── Edit form state ───
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmoji, setEditEmoji] = useState('')
  const [editPriority, setEditPriority] = useState<1 | 2 | 3>(2)
  const [editIsCore, setEditIsCore] = useState(false)
  const [editFreq, setEditFreq] = useState<'daily' | 'weekly'>('daily')
  const [editWeekDays, setEditWeekDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [editTime, setEditTime] = useState<'morning' | 'afternoon' | 'evening' | 'anytime'>('anytime')
  const [editWhy, setEditWhy] = useState('')
  const [editAiLoading, setEditAiLoading] = useState(false)

  // debounce timer ref for AI emoji
  const emojiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!user) return
    loadHabits()
  }, [user])

  // Auto-suggest emoji when new habit name changes (debounced)
  useEffect(() => {
    if (!newName.trim() || newEmoji) return
    if (emojiTimerRef.current) clearTimeout(emojiTimerRef.current)
    emojiTimerRef.current = setTimeout(() => {
      fetchSuggestedEmoji(newName, false)
    }, 800)
    return () => { if (emojiTimerRef.current) clearTimeout(emojiTimerRef.current) }
  }, [newName])

  async function fetchSuggestedEmoji(name: string, isEdit: boolean) {
    if (!name.trim()) return
    isEdit ? setEditAiLoading(true) : setAiEmojiLoading(true)
    try {
      const res = await fetch('/api/ai/suggest-emoji', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (data.emoji) {
        isEdit ? setEditEmoji(data.emoji) : setNewEmoji(data.emoji)
      }
    } catch { /* ignore */ }
    isEdit ? setEditAiLoading(false) : setAiEmojiLoading(false)
  }

  async function loadHabits() {
    if (!user) return
    try {
      const [habitDocs, todayLogDocs, last30Docs] = await Promise.all([
        queryDocuments('habits', [
          where('userId', '==', user.uid),
          where('isActive', '==', true),
          orderBy('priority', 'asc'),
        ]),
        queryDocuments('daily_habit_logs', [
          where('userId', '==', user.uid),
          where('date', '==', today),
        ]),
        queryDocuments('daily_habit_logs', [
          where('userId', '==', user.uid),
          orderBy('date', 'desc'),
        ]),
      ])

      const doneSet = new Set(todayLogDocs.filter(l => l.completed).map(l => l.habitId as string))
      setTodayLogs(doneSet)

      setHabits(habitDocs.map(h => {
        const habitLogs = last30Docs.filter(l => l.habitId === h.id)
        const datesDone = new Set(habitLogs.filter(l => l.completed).map(l => l.date as string))

        // Current streak
        let streak = 0
        for (let i = 0; i <= 30; i++) {
          const ds = getDateStr(i)
          if (datesDone.has(ds)) streak++
          else break
        }

        // 7-day rate
        let done7 = 0
        for (let i = 0; i < 7; i++) {
          if (datesDone.has(getDateStr(i))) done7++
        }

        // Last 3 days: [2 days ago, yesterday, today]
        const last3Days: (boolean | null)[] = [
          datesDone.has(getDateStr(2)) ? true : (habitLogs.some(l => l.date === getDateStr(2)) ? false : null),
          datesDone.has(getDateStr(1)) ? true : (habitLogs.some(l => l.date === getDateStr(1)) ? false : null),
          doneSet.has(h.id),
        ]

        return {
          id: h.id,
          name: h.name,
          emoji: h.emoji ?? '🎯',
          priority: h.priority ?? 2,
          isActive: true,
          isCoreHabit: h.isCoreHabit ?? false,
          frequency: h.frequency ?? 'daily',
          weekDays: h.weekDays ?? [1, 2, 3, 4, 5],
          scheduledTime: h.scheduledTime ?? 'anytime',
          why: h.why ?? '',
          currentStreak: streak,
          bestStreak: Math.max(h.bestStreak ?? 0, streak),
          completionRate7d: Math.round((done7 / 7) * 100),
          last3Days,
        }
      }))
    } catch (err) {
      console.error('loadHabits error:', err)
    } finally {
      setLoading(false)
    }
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
        userId: user.uid, date: today, eventType: 'habit',
        xpEarned: 10, description: `Completed habit: ${habit.name}`,
      })
    }
    setTodayLogs(newDone)
    // optimistic update last3Days
    setHabits(prev => prev.map(h => h.id === habit.id
      ? { ...h, last3Days: [h.last3Days[0], h.last3Days[1], !isDone] }
      : h
    ))
    await addDocument('daily_habit_logs', {
      userId: user.uid, date: today, habitId: habit.id,
      completed: !isDone, completedAt: new Date().toISOString(),
    })
  }

  function toggleWeekDay(day: number, days: number[], setDays: (d: number[]) => void) {
    setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day])
  }

  async function saveHabit() {
    if (!user || !newName.trim()) return
    setSaving(true)
    await addDocument('habits', {
      userId: user.uid,
      name: newName.trim(),
      emoji: newEmoji || '🎯',
      priority: newPriority,
      isActive: true,
      isCoreHabit: newIsCore,
      frequency: newFreq,
      weekDays: newFreq === 'weekly' ? newWeekDays : [],
      scheduledTime: newTime,
      why: newWhy.trim(),
      bestStreak: 0,
    })
    setNewName(''); setNewEmoji(''); setNewPriority(2); setNewIsCore(false)
    setNewFreq('daily'); setNewWeekDays([1, 2, 3, 4, 5]); setNewTime('anytime'); setNewWhy('')
    setShowAdd(false)
    setSaving(false)
    await loadHabits()
  }

  function startEdit(habit: Habit) {
    setEditingHabit(habit)
    setEditName(habit.name); setEditEmoji(habit.emoji); setEditPriority(habit.priority)
    setEditIsCore(habit.isCoreHabit); setEditFreq(habit.frequency)
    setEditWeekDays(habit.weekDays.length ? habit.weekDays : [1, 2, 3, 4, 5])
    setEditTime(habit.scheduledTime); setEditWhy(habit.why)
    setEditId(null)
  }

  async function saveEdit() {
    if (!editingHabit || !editName.trim()) return
    await updateDocument('habits', editingHabit.id, {
      name: editName.trim(), emoji: editEmoji || '🎯',
      priority: editPriority, isCoreHabit: editIsCore,
      frequency: editFreq, weekDays: editFreq === 'weekly' ? editWeekDays : [],
      scheduledTime: editTime, why: editWhy.trim(),
    })
    setHabits(prev => prev.map(h => h.id === editingHabit.id ? {
      ...h, name: editName.trim(), emoji: editEmoji || '🎯',
      priority: editPriority, isCoreHabit: editIsCore,
      frequency: editFreq, weekDays: editFreq === 'weekly' ? editWeekDays : [],
      scheduledTime: editTime, why: editWhy.trim(),
    } : h))
    setEditingHabit(null)
  }

  async function archiveHabit(id: string) {
    await updateDocument('habits', id, { isActive: false })
    setHabits(prev => prev.filter(h => h.id !== id))
  }

  // ─── Stats ───
  const doneCount = todayLogs.size
  const totalHabits = habits.length
  const consistentCount = habits.filter(h => h.completionRate7d >= 70).length
  const topStreak = Math.max(...habits.map(h => h.currentStreak), 0)

  // ─── Habit form (shared for add / edit) ───
  function HabitForm({
    isEdit, name, setName, emoji, setEmoji, priority, setPriority,
    isCore, setIsCore, freq, setFreq, weekDays, setWeekDays,
    time, setTime, why, setWhy, aiLoading: aiL,
    onSave, onCancel, saving: sav,
  }: {
    isEdit: boolean
    name: string; setName: (v: string) => void
    emoji: string; setEmoji: (v: string) => void
    priority: 1|2|3; setPriority: (v: 1|2|3) => void
    isCore: boolean; setIsCore: (v: boolean) => void
    freq: 'daily'|'weekly'; setFreq: (v: 'daily'|'weekly') => void
    weekDays: number[]; setWeekDays: (v: number[]) => void
    time: typeof TIME_OPTS[number]; setTime: (v: typeof TIME_OPTS[number]) => void
    why: string; setWhy: (v: string) => void
    aiLoading: boolean
    onSave: () => void; onCancel: () => void; saving: boolean
  }) {
    return (
      <div className="card space-y-3">
        <h3 className="font-semibold text-sm">{isEdit ? '✏️ Edit Habit' : '✨ New Habit'}</h3>

        {/* Name + emoji */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-shrink-0">
            <input value={emoji} onChange={e => setEmoji(e.target.value)}
              className="w-11 h-11 text-center text-xl rounded-xl outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              maxLength={2} placeholder="🎯" />
            {aiL && (
              <span className="absolute -top-1 -right-1 text-[9px] px-1 rounded-full"
                style={{ background: '#a855f7', color: 'white' }}>AI</span>
            )}
          </div>
          <div className="flex-1">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Habit name (e.g. Morning run, Read 20 pages…)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              autoFocus={!isEdit} />
          </div>
          <button onClick={() => fetchSuggestedEmoji(name, isEdit)} disabled={!name.trim() || aiL}
            className="text-xs px-2 py-2 rounded-xl flex-shrink-0 disabled:opacity-40"
            style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
            ✨
          </button>
        </div>

        {/* Why */}
        <div>
          <label className="text-xs text-muted mb-1 block">💡 Why do you want this habit?</label>
          <input type="text" value={why} onChange={e => setWhy(e.target.value)}
            placeholder="e.g. To feel more energetic, to get fit for marriage…"
            className="w-full px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
        </div>

        {/* Frequency */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">📅 Frequency</label>
          <div className="flex gap-2">
            {(['daily', 'weekly'] as const).map(f => (
              <button key={f} onClick={() => setFreq(f)}
                className="flex-1 py-2 rounded-xl text-xs font-medium capitalize"
                style={{
                  background: freq === f ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                  border: freq === f ? '1px solid #14b8a6' : '1px solid var(--border)',
                  color: freq === f ? '#14b8a6' : 'var(--muted)',
                }}>
                {f === 'daily' ? '📆 Every day' : '📅 Specific days'}
              </button>
            ))}
          </div>
          {freq === 'weekly' && (
            <div className="flex gap-1.5 mt-2">
              {DAY_LABELS.map((label, i) => (
                <button key={i} onClick={() => toggleWeekDay(i, weekDays, setWeekDays)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                  style={{
                    background: weekDays.includes(i) ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                    border: weekDays.includes(i) ? '1px solid #14b8a6' : '1px solid var(--border)',
                    color: weekDays.includes(i) ? '#14b8a6' : 'var(--muted)',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* When */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">⏰ When do you plan to do it?</label>
          <div className="flex gap-2">
            {TIME_OPTS.map(t => (
              <button key={t} onClick={() => setTime(t)}
                className="flex-1 py-2 rounded-xl text-xs font-medium"
                style={{
                  background: time === t ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                  border: time === t ? '1px solid #14b8a6' : '1px solid var(--border)',
                  color: time === t ? '#14b8a6' : 'var(--muted)',
                }}>
                {TIME_ICONS[t]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-1 text-center capitalize">{TIME_ICONS[time]} {time}</p>
        </div>

        {/* Priority */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">Priority</label>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className="flex-1 py-2 rounded-xl text-xs font-bold"
                style={{
                  background: priority === p ? (p === 1 ? 'rgba(239,68,68,0.15)' : p === 2 ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)') : 'var(--surface-2)',
                  border: priority === p ? `1px solid ${PRIORITY_COLOR[p]}` : '1px solid var(--border)',
                  color: priority === p ? PRIORITY_COLOR[p] : 'var(--muted)',
                }}>
                P{p} — {p === 1 ? 'Must' : p === 2 ? 'Should' : 'Nice'}
              </button>
            ))}
          </div>
        </div>

        {/* Core */}
        <button onClick={() => setIsCore(!isCore)}
          className="flex items-center gap-2 text-sm"
          style={{ color: isCore ? '#14b8a6' : 'var(--muted)' }}>
          <span className="w-5 h-5 rounded flex items-center justify-center text-xs"
            style={{ background: isCore ? '#14b8a6' : 'var(--surface-2)', border: `1px solid ${isCore ? '#14b8a6' : 'var(--border)'}`, color: 'white' }}>
            {isCore ? '✓' : ''}
          </span>
          Core habit (shown in Burnout Mode)
        </button>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
          <button onClick={onSave} disabled={!name.trim() || sav}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: '#14b8a6', color: 'white' }}>
            {sav ? '...' : isEdit ? 'Update' : 'Save habit'}
          </button>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading habits...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* ─── Stats bar ─── */}
      <div className="grid grid-cols-4 gap-2">
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{doneCount}</p>
          <p className="text-[10px] text-muted">Done today</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#14b8a6' }}>{totalHabits}</p>
          <p className="text-[10px] text-muted">Active</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#a855f7' }}>{consistentCount}</p>
          <p className="text-[10px] text-muted">Consistent</p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#f59e0b' }}>🔥{topStreak}</p>
          <p className="text-[10px] text-muted">Top streak</p>
        </div>
      </div>

      {/* ─── Add form ─── */}
      {showAdd ? (
        <HabitForm
          isEdit={false}
          name={newName} setName={setNewName}
          emoji={newEmoji} setEmoji={setNewEmoji}
          priority={newPriority} setPriority={setNewPriority}
          isCore={newIsCore} setIsCore={setNewIsCore}
          freq={newFreq} setFreq={setNewFreq}
          weekDays={newWeekDays} setWeekDays={setNewWeekDays}
          time={newTime} setTime={setNewTime}
          why={newWhy} setWhy={setNewWhy}
          aiLoading={aiEmojiLoading}
          onSave={saveHabit} onCancel={() => setShowAdd(false)} saving={saving}
        />
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
          <span className="text-lg">+</span> Add new habit
        </button>
      )}

      {/* ─── Habits list ─── */}
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
            const pColor = PRIORITY_COLOR[habit.priority]
            const isConsistent = habit.completionRate7d >= 70
            const isEditing = editingHabit?.id === habit.id

            return (
              <div key={habit.id} className="card"
                style={{
                  border: done ? '1px solid rgba(34,197,94,0.35)' : atRisk ? '1px solid rgba(245,158,11,0.35)' : '1px solid var(--border)',
                }}>

                {/* ── Main row ── */}
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button onClick={() => toggleHabit(habit)}
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                    style={{
                      background: done ? '#22c55e' : 'transparent',
                      border: done ? 'none' : `2px solid ${pColor}`,
                    }}>
                    {done && <span className="text-white text-xs font-bold">✓</span>}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-base">{habit.emoji}</span>
                      <span className="font-semibold text-sm"
                        style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--muted)' : 'var(--foreground)' }}>
                        {habit.name}
                      </span>
                      {habit.isCoreHabit && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>core</span>
                      )}
                      {isConsistent && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>consistent ✓</span>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-bold" style={{ color: pColor }}>P{habit.priority}</span>
                      <span className="text-[10px] text-muted">{TIME_ICONS[habit.scheduledTime]} {habit.scheduledTime}</span>
                      <span className="text-[10px] text-muted capitalize">
                        {habit.frequency === 'weekly' && habit.weekDays.length
                          ? `${habit.weekDays.length}×/wk`
                          : 'daily'}
                      </span>
                      {habit.currentStreak > 0 && (
                        <span className="text-[10px] text-muted">🔥 {habit.currentStreak}d streak</span>
                      )}
                      {atRisk && (
                        <span className="text-[10px]" style={{ color: '#f59e0b' }}>⚠️ at risk</span>
                      )}
                    </div>

                    {/* Why (collapsed, shown only if present) */}
                    {habit.why && (
                      <p className="text-[10px] mt-0.5 italic" style={{ color: 'var(--muted)' }}>
                        💡 {habit.why}
                      </p>
                    )}
                  </div>

                  <button onClick={() => setEditId(editId === habit.id ? null : habit.id)}
                    className="text-muted text-sm px-1 flex-shrink-0">⋯</button>
                </div>

                {/* ── Last 3 days + consistency bar ── */}
                <div className="mt-2.5 flex items-center gap-3">
                  {/* 3-day dots */}
                  <div className="flex items-center gap-1">
                    {(['2d ago', 'Yesterday', 'Today'] as const).map((label, i) => {
                      const val = habit.last3Days[i]
                      return (
                        <div key={label} className="flex flex-col items-center gap-0.5">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                            style={{
                              background: val === true ? '#22c55e'
                                : val === false ? 'rgba(239,68,68,0.15)'
                                : 'var(--surface-2)',
                              color: val === true ? 'white' : val === false ? '#ef4444' : 'var(--muted)',
                              border: val === null ? '1px dashed var(--border)' : 'none',
                            }}>
                            {val === true ? '✓' : val === false ? '✕' : '–'}
                          </div>
                          <span className="text-[8px] text-muted">{label === 'Today' ? 'Today' : label}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Consistency bar */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] text-muted">7-day</span>
                      <span className="text-[9px] font-medium" style={{ color: isConsistent ? '#22c55e' : '#f59e0b' }}>
                        {habit.completionRate7d}%
                      </span>
                    </div>
                    <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${habit.completionRate7d}%`,
                          background: habit.completionRate7d >= 70 ? '#22c55e' : habit.completionRate7d >= 40 ? '#f59e0b' : '#ef4444',
                        }} />
                    </div>
                  </div>
                </div>

                {/* ── Actions dropdown ── */}
                {editId === habit.id && !isEditing && (
                  <div className="flex gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => startEdit(habit)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                    <button onClick={() => archiveHabit(habit.id)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>📦 Archive</button>
                  </div>
                )}

                {/* ── Inline edit form ── */}
                {isEditing && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <HabitForm
                      isEdit={true}
                      name={editName} setName={setEditName}
                      emoji={editEmoji} setEmoji={setEditEmoji}
                      priority={editPriority} setPriority={setEditPriority}
                      isCore={editIsCore} setIsCore={setEditIsCore}
                      freq={editFreq} setFreq={setEditFreq}
                      weekDays={editWeekDays} setWeekDays={setEditWeekDays}
                      time={editTime} setTime={setEditTime}
                      why={editWhy} setWhy={setEditWhy}
                      aiLoading={editAiLoading}
                      onSave={saveEdit} onCancel={() => setEditingHabit(null)} saving={false}
                    />
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
