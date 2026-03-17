'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'

interface Habit {
  id: string
  name: string
  emoji: string
  priority: 1 | 2 | 3
  isActive: boolean
  isCoreHabit: boolean
  frequency: 'daily' | 'weekly'
  weekDays: number[]
  scheduledTime: 'morning' | 'afternoon' | 'evening' | 'anytime'
  why: string
  currentStreak: number
  bestStreak: number
  completionRate7d: number
  last3Days: (boolean | null)[]
  habitType: 'boolean' | 'count'
  targetCount: number
  todayCount: number  // for count-based habits
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

// ─── Pure helper — safe to live outside the component ───
function toggleWeekDay(day: number, days: number[], setDays: (d: number[]) => void) {
  setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day])
}

// ─── HabitForm defined OUTSIDE HabitsPage to prevent unmount/remount on every keystroke ───
interface HabitFormProps {
  isEdit: boolean
  name: string; setName: (v: string) => void
  emoji: string; setEmoji: (v: string) => void
  priority: 1 | 2 | 3; setPriority: (v: 1 | 2 | 3) => void
  isCore: boolean; setIsCore: (v: boolean) => void
  freq: 'daily' | 'weekly'; setFreq: (v: 'daily' | 'weekly') => void
  weekDays: number[]; setWeekDays: (v: number[]) => void
  time: typeof TIME_OPTS[number]; setTime: (v: typeof TIME_OPTS[number]) => void
  why: string; setWhy: (v: string) => void
  habitType: 'boolean' | 'count'; setHabitType: (v: 'boolean' | 'count') => void
  targetCount: string; setTargetCount: (v: string) => void
  aiLoading: boolean
  onSuggestEmoji: () => void
  onSave: () => void; onCancel: () => void; saving: boolean
}

function HabitForm({
  isEdit, name, setName, emoji, setEmoji, priority, setPriority,
  isCore, setIsCore, freq, setFreq, weekDays, setWeekDays,
  time, setTime, why, setWhy, habitType, setHabitType, targetCount, setTargetCount,
  aiLoading, onSuggestEmoji, onSave, onCancel, saving,
}: HabitFormProps) {
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
          {aiLoading && (
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
        <button onClick={onSuggestEmoji} disabled={!name.trim() || aiLoading}
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

      {/* Habit type */}
      <div>
        <label className="text-xs text-muted mb-1.5 block">🎯 Tracking type</label>
        <div className="flex gap-2">
          {(['boolean', 'count'] as const).map(t => (
            <button key={t} onClick={() => setHabitType(t)}
              className="flex-1 py-2 rounded-xl text-xs font-medium"
              style={{
                background: habitType === t ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                border: habitType === t ? '1px solid #14b8a6' : '1px solid var(--border)',
                color: habitType === t ? '#14b8a6' : 'var(--muted)',
              }}>
              {t === 'boolean' ? '✅ Done / Not done' : '🔢 Reach a count'}
            </button>
          ))}
        </div>
        {habitType === 'count' && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted">Daily target:</span>
            <input type="number" value={targetCount} onChange={e => setTargetCount(e.target.value)}
              placeholder="e.g. 20" min="1"
              className="w-24 px-3 py-1.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            <span className="text-xs text-muted">actions/day</span>
          </div>
        )}
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
        <button onClick={onSave} disabled={!name.trim() || saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
          style={{ background: '#14b8a6', color: 'white' }}>
          {saving ? '...' : isEdit ? 'Update' : 'Save habit'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───
export default function HabitsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [habits, setHabits] = useState<Habit[]>([])
  const [todayLogs, setTodayLogs] = useState<Set<string>>(new Set())
  const [viewDate, setViewDate] = useState(today)
  const [viewLogs, setViewLogs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)

  // Add form state
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2)
  const [newIsCore, setNewIsCore] = useState(false)
  const [newFreq, setNewFreq] = useState<'daily' | 'weekly'>('daily')
  const [newWeekDays, setNewWeekDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [newTime, setNewTime] = useState<'morning' | 'afternoon' | 'evening' | 'anytime'>('anytime')
  const [newWhy, setNewWhy] = useState('')
  const [newHabitType, setNewHabitType] = useState<'boolean' | 'count'>('boolean')
  const [newTargetCount, setNewTargetCount] = useState('1')
  const [saving, setSaving] = useState(false)
  const [aiEmojiLoading, setAiEmojiLoading] = useState(false)

  // Edit form state
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmoji, setEditEmoji] = useState('')
  const [editPriority, setEditPriority] = useState<1 | 2 | 3>(2)
  const [editIsCore, setEditIsCore] = useState(false)
  const [editFreq, setEditFreq] = useState<'daily' | 'weekly'>('daily')
  const [editWeekDays, setEditWeekDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [editTime, setEditTime] = useState<'morning' | 'afternoon' | 'evening' | 'anytime'>('anytime')
  const [editWhy, setEditWhy] = useState('')
  const [editHabitType, setEditHabitType] = useState<'boolean' | 'count'>('boolean')
  const [editTargetCount, setEditTargetCount] = useState('1')
  const [editAiLoading, setEditAiLoading] = useState(false)

  const emojiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiSortLoading, setAiSortLoading] = useState(false)
  const [aiSortedIds, setAiSortedIds] = useState<string[] | null>(null)

  // Page-level tab: habits list vs bad habits tracker
  const [pageTab, setPageTab] = useState<'habits' | 'bad-habits'>('habits')

  // Bad habits tracker state
  const [badHabitName, setBadHabitName] = useState('')
  const [badHabitCue, setBadHabitCue] = useState('')
  const [badHabitTrigger, setBadHabitTrigger] = useState('')
  const [badHabitThoughts, setBadHabitThoughts] = useState('')
  const [badHabitIntensity, setBadHabitIntensity] = useState(3)
  const [badHabitLogs, setBadHabitLogs] = useState<DocumentData[]>([])
  const [savingBadHabit, setSavingBadHabit] = useState(false)
  const [badHabitAiAnalysis, setBadHabitAiAnalysis] = useState('')
  const [badHabitAiLoading, setBadHabitAiLoading] = useState(false)

  const BAD_HABIT_PRESETS = ['Doomscrolling', 'Late-night snacking', 'Skipping workout', 'Procrastinating', 'Oversleeping', 'Impulse buying', 'Negative self-talk']

  useEffect(() => {
    if (!user) return
    loadHabits()
  }, [user])

  // Reload logs when viewDate changes
  useEffect(() => {
    if (!user || !viewDate || loading) return
    if (viewDate === today) {
      setViewLogs(todayLogs)
    } else {
      loadLogsForDate(viewDate)
    }
  }, [viewDate, user])

  // Auto-suggest emoji when new habit name changes (debounced)
  useEffect(() => {
    if (!newName.trim() || newEmoji) return
    if (emojiTimerRef.current) clearTimeout(emojiTimerRef.current)
    emojiTimerRef.current = setTimeout(() => {
      fetchSuggestedEmoji(newName, false)
    }, 800)
    return () => { if (emojiTimerRef.current) clearTimeout(emojiTimerRef.current) }
  }, [newName])

  async function loadLogsForDate(date: string) {
    if (!user) return
    try {
      const logs = await queryDocuments('daily_habit_logs', [
        where('userId', '==', user.uid),
        where('date', '==', date),
      ])
      setViewLogs(new Set(logs.filter(l => l.completed).map(l => l.habitId as string)))
    } catch { /* ignore */ }
  }

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
      setViewLogs(doneSet)

      setHabits(habitDocs.map(h => {
        const habitLogs = last30Docs.filter(l => l.habitId === h.id)
        const datesDone = new Set(habitLogs.filter(l => l.completed).map(l => l.date as string))

        let streak = 0
        for (let i = 0; i <= 30; i++) {
          const ds = getDateStr(i)
          if (datesDone.has(ds)) streak++
          else break
        }

        let done7 = 0
        for (let i = 0; i < 7; i++) {
          if (datesDone.has(getDateStr(i))) done7++
        }

        const last3Days: (boolean | null)[] = [
          datesDone.has(getDateStr(2)) ? true : (habitLogs.some(l => l.date === getDateStr(2)) ? false : null),
          datesDone.has(getDateStr(1)) ? true : (habitLogs.some(l => l.date === getDateStr(1)) ? false : null),
          doneSet.has(h.id),
        ]

        const todayLogForHabit = todayLogDocs.find(l => l.habitId === h.id)
        return {
          id: h.id, name: h.name, emoji: h.emoji ?? '🎯', priority: h.priority ?? 2,
          isActive: true, isCoreHabit: h.isCoreHabit ?? false,
          frequency: h.frequency ?? 'daily', weekDays: h.weekDays ?? [1, 2, 3, 4, 5],
          scheduledTime: h.scheduledTime ?? 'anytime', why: h.why ?? '',
          currentStreak: streak, bestStreak: Math.max(h.bestStreak ?? 0, streak),
          completionRate7d: Math.round((done7 / 7) * 100), last3Days,
          habitType: (h.habitType ?? 'boolean') as 'boolean' | 'count',
          targetCount: h.targetCount ?? 1,
          todayCount: todayLogForHabit?.countValue ?? 0,
        }
      }))
    } catch (err) {
      console.error('loadHabits error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function incrementCount(habit: Habit, amount = 1) {
    if (!user || habit.habitType !== 'count') return
    const newCount = habit.todayCount + amount
    const isDone   = newCount >= habit.targetCount
    setHabits(prev => prev.map(h => h.id === habit.id ? { ...h, todayCount: newCount } : h))
    if (isDone && !activeLogs.has(habit.id)) {
      const newDone = new Set(todayLogs)
      newDone.add(habit.id)
      setTodayLogs(newDone); setViewLogs(newDone)
    }
    await addDocument('daily_habit_logs', {
      userId: user.uid, date: today, habitId: habit.id,
      completed: isDone, countValue: newCount, completedAt: new Date().toISOString(),
    })
    if (isDone && !activeLogs.has(habit.id)) {
      await addDocument('xp_events', { userId: user.uid, date: today, eventType: 'habit', xpEarned: 10, description: `Completed habit: ${habit.name}` })
    }
  }

  async function toggleHabit(habit: Habit) {
    if (!user) return
    const isViewingToday = viewDate === today
    const currentLogs = isViewingToday ? todayLogs : viewLogs
    const newDone = new Set(currentLogs)
    const isDone = newDone.has(habit.id)
    if (isDone) {
      newDone.delete(habit.id)
      // Reverse XP: find and delete today's xp_event for this habit
      if (isViewingToday) {
        const evts = await queryDocuments('xp_events', [
          where('userId', '==', user.uid), where('date', '==', viewDate), where('eventType', '==', 'habit'),
        ])
        const evt = (evts as DocumentData[]).find(e => e.description?.includes(habit.name))
        if (evt) await deleteDocument('xp_events', evt.id)
        // Also decrement user_xp.xpTotal
        const xpDocs = await queryDocuments('user_xp', [where('userId', '==', user.uid)])
        if (xpDocs.length > 0) {
          await updateDocument('user_xp', xpDocs[0].id, { xpTotal: Math.max(0, (xpDocs[0].xpTotal ?? 0) - 10) })
        }
      }
    } else {
      newDone.add(habit.id)
      if (isViewingToday) {
        const newEvt = await addDocument('xp_events', {
          userId: user.uid, date: viewDate, eventType: 'habit',
          xpEarned: 10, description: `Completed habit: ${habit.name}`,
        })
        // Update user_xp.xpTotal
        const xpDocs = await queryDocuments('user_xp', [where('userId', '==', user.uid)])
        if (xpDocs.length > 0) {
          await updateDocument('user_xp', xpDocs[0].id, { xpTotal: (xpDocs[0].xpTotal ?? 0) + 10 })
        } else {
          await addDocument('user_xp', { userId: user.uid, xpTotal: 10, level: 1 })
        }
        void newEvt
      }
    }
    if (isViewingToday) {
      setTodayLogs(newDone)
      setViewLogs(newDone)
    } else {
      setViewLogs(newDone)
    }
    // Update last3Days in-memory so the 3-day dots reflect the change immediately
    const dayIndex = viewDate === getDateStr(2) ? 0 : viewDate === getDateStr(1) ? 1 : 2
    setHabits(prev => prev.map(h => {
      if (h.id !== habit.id) return h
      const newLast3 = [...h.last3Days] as (boolean | null)[]
      newLast3[dayIndex] = !isDone
      return { ...h, last3Days: newLast3 }
    }))
    await addDocument('daily_habit_logs', {
      userId: user.uid, date: viewDate, habitId: habit.id,
      completed: !isDone, completedAt: new Date().toISOString(),
    })
  }

  async function saveHabit() {
    if (!user || !newName.trim()) return
    setSaving(true)
    await addDocument('habits', {
      userId: user.uid, name: newName.trim(), emoji: newEmoji || '🎯',
      priority: newPriority, isActive: true, isCoreHabit: newIsCore,
      frequency: newFreq, weekDays: newFreq === 'weekly' ? newWeekDays : [],
      scheduledTime: newTime, why: newWhy.trim(), bestStreak: 0,
      habitType: newHabitType, targetCount: newHabitType === 'count' ? parseInt(newTargetCount) || 1 : 1,
    })
    setNewName(''); setNewEmoji(''); setNewPriority(2); setNewIsCore(false)
    setNewFreq('daily'); setNewWeekDays([1, 2, 3, 4, 5]); setNewTime('anytime'); setNewWhy('')
    setNewHabitType('boolean'); setNewTargetCount('1')
    setShowAdd(false); setSaving(false)
    await loadHabits()
  }

  function startEdit(habit: Habit) {
    setEditingHabit(habit)
    setEditName(habit.name); setEditEmoji(habit.emoji); setEditPriority(habit.priority)
    setEditIsCore(habit.isCoreHabit); setEditFreq(habit.frequency)
    setEditWeekDays(habit.weekDays.length ? habit.weekDays : [1, 2, 3, 4, 5])
    setEditTime(habit.scheduledTime); setEditWhy(habit.why)
    setEditHabitType(habit.habitType); setEditTargetCount(String(habit.targetCount))
    setEditId(null)
  }

  async function saveEdit() {
    if (!editingHabit || !editName.trim()) return
    await updateDocument('habits', editingHabit.id, {
      name: editName.trim(), emoji: editEmoji || '🎯',
      priority: editPriority, isCoreHabit: editIsCore,
      frequency: editFreq, weekDays: editFreq === 'weekly' ? editWeekDays : [],
      scheduledTime: editTime, why: editWhy.trim(),
      habitType: editHabitType, targetCount: editHabitType === 'count' ? parseInt(editTargetCount) || 1 : 1,
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

  async function sortByAI() {
    if (!user || aiSortLoading || habits.length === 0) return
    setAiSortLoading(true)
    try {
      const now = new Date()
      const hour = now.getHours()
      const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
      const activeLogs_ = viewDate === today ? todayLogs : viewLogs
      const doneIds = habits.filter(h => activeLogs_.has(h.id)).map(h => h.id)
      const pendingHabits = habits.filter(h => !activeLogs_.has(h.id))
      const res = await fetch('/api/ai/sort-habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          habits: pendingHabits.map(h => ({
            id: h.id, name: h.name, scheduledTime: h.scheduledTime,
            completionRate7d: h.completionRate7d, currentStreak: h.currentStreak, priority: h.priority,
          })),
          timeOfDay, doneIds,
        }),
      })
      const data = await res.json()
      if (data.sortedIds?.length) {
        // Combine: done habits at end, undone in AI order
        const doneHabits = habits.filter(h => activeLogs_.has(h.id))
        setAiSortedIds([...data.sortedIds, ...doneHabits.map((h: Habit) => h.id)])
      }
    } catch { /* ignore */ }
    setAiSortLoading(false)
  }

  async function loadBadHabitLogs() {
    if (!user) return
    const docs = await queryDocuments('bad_habit_logs', [
      where('userId', '==', user.uid), orderBy('timestamp', 'desc'),
    ])
    setBadHabitLogs(docs)
  }

  async function saveBadHabit() {
    if (!user || !badHabitName.trim()) return
    setSavingBadHabit(true)
    const doc = {
      userId: user.uid,
      date: today,
      timestamp: new Date().toISOString(),
      badHabitName: badHabitName.trim(),
      cue: badHabitCue.trim(),
      trigger: badHabitTrigger.trim(),
      thoughts: badHabitThoughts.trim(),
      intensity: badHabitIntensity,
    }
    await addDocument('bad_habit_logs', doc)
    setBadHabitLogs(prev => [{ id: Date.now().toString(), ...doc }, ...prev])
    setBadHabitName(''); setBadHabitCue(''); setBadHabitTrigger(''); setBadHabitThoughts(''); setBadHabitIntensity(3)
    setSavingBadHabit(false)
  }

  async function analyzeBadHabits() {
    if (!user || badHabitLogs.length === 0) return
    setBadHabitAiLoading(true)
    try {
      const sample = badHabitLogs.slice(0, 20).map(l => ({
        name: l.badHabitName, cue: l.cue, trigger: l.trigger, thoughts: l.thoughts, intensity: l.intensity, date: l.date,
      }))
      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'bad-habits',
          userId: user.uid,
          data: `Analyze these ${sample.length} bad habit log entries. Identify: 1) the top 2 recurring triggers or cues, 2) a pattern in timing or thoughts, 3) one concrete replacement habit or coping strategy. Be direct and specific — reference actual entries.\n\nData: ${JSON.stringify(sample)}`,
        }),
      })
      const resData = await res.json()
      setBadHabitAiAnalysis(resData.insight ?? '')
    } catch { setBadHabitAiAnalysis('Could not generate analysis — try again.') }
    setBadHabitAiLoading(false)
  }

  const activeLogs = viewDate === today ? todayLogs : viewLogs
  const doneCount = activeLogs.size
  const totalHabits = habits.length
  const consistentCount = habits.filter(h => h.completionRate7d >= 70).length
  const topStreak = Math.max(...habits.map(h => h.currentStreak), 0)

  // AI-sorted or default order; always push done habits to bottom
  const displayHabits = (() => {
    const sorted = aiSortedIds
      ? [...habits].sort((a, b) => {
          const ia = aiSortedIds.indexOf(a.id)
          const ib = aiSortedIds.indexOf(b.id)
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
        })
      : habits
    const pending = sorted.filter(h => !activeLogs.has(h.id))
    const done    = sorted.filter(h =>  activeLogs.has(h.id))
    return [...pending, ...done]
  })()

  // Date selector options: [2 days ago, yesterday, today]
  const dateOptions = [
    { label: '2d ago', date: getDateStr(2) },
    { label: 'Yesterday', date: getDateStr(1) },
    { label: 'Today', date: today },
  ]

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading habits...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* ─── Page-level tab switcher ─── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
        {([['habits', '✅ Habits'], ['bad-habits', '⚠️ Cravings']] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setPageTab(key); if (key === 'bad-habits' && badHabitLogs.length === 0) loadBadHabitLogs() }}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: pageTab === key ? 'var(--background)' : 'transparent',
              color: pageTab === key ? (key === 'bad-habits' ? '#ef4444' : '#14b8a6') : 'var(--muted)',
              boxShadow: pageTab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── Bad Habits Tracker ─── */}
      {pageTab === 'bad-habits' && (
        <div className="space-y-4">
          {/* Log form */}
          <div className="card space-y-3" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
            <h3 className="font-semibold text-sm" style={{ color: '#ef4444' }}>⚠️ Log a Craving or Slip</h3>
            <p className="text-xs text-muted">Record what triggered it while it&apos;s fresh — this is how patterns surface.</p>

            {/* Preset chips */}
            <div>
              <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">What happened?</p>
              <div className="flex flex-wrap gap-1.5">
                {BAD_HABIT_PRESETS.map(p => (
                  <button key={p} onClick={() => setBadHabitName(p)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: badHabitName === p ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)',
                      border: badHabitName === p ? '1px solid #ef4444' : '1px solid var(--border)',
                      color: badHabitName === p ? '#ef4444' : 'var(--muted)',
                    }}>
                    {p}
                  </button>
                ))}
              </div>
              <input type="text" value={badHabitName} onChange={e => setBadHabitName(e.target.value)}
                placeholder="Or describe it…"
                className="mt-2 w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <input type="text" value={badHabitCue} onChange={e => setBadHabitCue(e.target.value)}
                placeholder="Cue / situation (e.g. 'Bored at 11pm')"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <input type="text" value={badHabitTrigger} onChange={e => setBadHabitTrigger(e.target.value)}
                placeholder="Trigger / what caused it (e.g. 'Stressed about work')"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <textarea value={badHabitThoughts} onChange={e => setBadHabitThoughts(e.target.value)}
                placeholder="Thoughts at the time…"
                rows={2}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>

            <div>
              <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">Intensity</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setBadHabitIntensity(n)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                    style={{
                      background: badHabitIntensity === n ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)',
                      border: badHabitIntensity === n ? '1px solid #ef4444' : '1px solid var(--border)',
                      color: badHabitIntensity === n ? '#ef4444' : 'var(--muted)',
                    }}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-muted">Mild urge</span>
                <span className="text-[9px] text-muted">Gave in fully</span>
              </div>
            </div>

            <button onClick={saveBadHabit} disabled={!badHabitName.trim() || savingBadHabit}
              className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#ef4444', color: 'white' }}>
              {savingBadHabit ? 'Saving…' : 'Log it'}
            </button>
          </div>

          {/* AI Analysis */}
          {badHabitLogs.length >= 3 && (
            <div className="card space-y-2" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">🧠 What triggers me?</h3>
                <button onClick={analyzeBadHabits} disabled={badHabitAiLoading}
                  className="text-[10px] px-2.5 py-1 rounded-lg disabled:opacity-40"
                  style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                  {badHabitAiLoading ? '⏳' : 'Analyse'}
                </button>
              </div>
              {badHabitAiAnalysis && (
                <p className="text-sm leading-relaxed">{badHabitAiAnalysis}</p>
              )}
              {!badHabitAiAnalysis && !badHabitAiLoading && (
                <p className="text-xs text-muted">Tap Analyse to find patterns in your {badHabitLogs.length} entries.</p>
              )}
            </div>
          )}

          {/* Past logs */}
          {badHabitLogs.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-sm mb-3">📋 Recent entries ({badHabitLogs.length})</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {badHabitLogs.slice(0, 20).map((log, i) => (
                  <div key={log.id ?? i} className="px-3 py-2.5 rounded-xl space-y-1"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: '#ef4444' }}>{log.badHabitName}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted">{log.date}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                          {log.intensity}/5
                        </span>
                      </div>
                    </div>
                    {log.cue && <p className="text-xs text-muted">📍 {log.cue}</p>}
                    {log.trigger && <p className="text-xs text-muted">⚡ {log.trigger}</p>}
                    {log.thoughts && <p className="text-xs text-muted italic">&ldquo;{log.thoughts}&rdquo;</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {badHabitLogs.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <p className="text-3xl">🧘</p>
              <p className="text-sm font-medium">No entries yet</p>
              <p className="text-xs text-muted">Log cravings or slips above — patterns will emerge.</p>
            </div>
          )}
        </div>
      )}

      {pageTab === 'habits' && <>
      {/* ─── Stats bar ─── */}
      <div className="grid grid-cols-4 gap-2">
        <div className="card-sm text-center">
          <p className="text-xl font-bold" style={{ color: '#22c55e' }}>{doneCount}</p>
          <p className="text-[10px] text-muted">Done {viewDate === today ? 'today' : ''}</p>
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

      {/* ─── Date Selector ─── */}
      <div className="flex gap-2">
        {dateOptions.map(opt => (
          <button key={opt.date} onClick={() => setViewDate(opt.date)}
            className="flex-1 py-2 rounded-xl text-xs font-medium"
            style={{
              background: viewDate === opt.date ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
              border: viewDate === opt.date ? '1px solid #14b8a6' : '1px solid var(--border)',
              color: viewDate === opt.date ? '#14b8a6' : 'var(--muted)',
            }}>
            {opt.label}
          </button>
        ))}
      </div>
      {viewDate !== today && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
          ✏️ Editing: {viewDate === getDateStr(1) ? 'Yesterday' : '2 days ago'} — tap any habit to toggle
        </div>
      )}

      {/* ─── AI Sort button ─── */}
      {habits.length > 1 && (
        <div className="flex items-center gap-2">
          <button onClick={sortByAI} disabled={aiSortLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-50 transition-all"
            style={{
              background: aiSortedIds ? 'rgba(168,85,247,0.15)' : 'var(--surface-2)',
              border: aiSortedIds ? '1px solid rgba(168,85,247,0.4)' : '1px solid var(--border)',
              color: aiSortedIds ? '#a855f7' : 'var(--muted)',
            }}>
            {aiSortLoading ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                AI sorting…
              </>
            ) : aiSortedIds ? (
              <>✨ AI sorted — tap to re-sort</>
            ) : (
              <>🤖 AI sort by best order</>
            )}
          </button>
          {aiSortedIds && (
            <button onClick={() => setAiSortedIds(null)}
              className="px-2.5 py-2 rounded-xl text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              ✕ Reset
            </button>
          )}
        </div>
      )}

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
          habitType={newHabitType} setHabitType={setNewHabitType}
          targetCount={newTargetCount} setTargetCount={setNewTargetCount}
          aiLoading={aiEmojiLoading}
          onSuggestEmoji={() => fetchSuggestedEmoji(newName, false)}
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
          {displayHabits.map(habit => {
            const done = activeLogs.has(habit.id)
            const atRisk = habit.currentStreak > 0 && !done && viewDate === today
            const pColor = PRIORITY_COLOR[habit.priority]
            const isConsistent = habit.completionRate7d >= 70
            const isEditing = editingHabit?.id === habit.id

            const isCountHabit = habit.habitType === 'count'
            const countPct    = isCountHabit ? Math.min((habit.todayCount / habit.targetCount) * 100, 100) : 0

            return (
              <div key={habit.id} className="card"
                style={{
                  border: done ? '1px solid rgba(34,197,94,0.35)' : atRisk ? '1px solid rgba(245,158,11,0.35)' : '1px solid var(--border)',
                }}>

                {/* ── Main row ── */}
                <div className="flex items-start gap-3">
                  {isCountHabit ? (
                    <button onClick={() => incrementCount(habit)}
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all text-xs font-bold"
                      style={{ background: done ? '#22c55e' : 'rgba(20,184,166,0.15)', border: done ? 'none' : `2px solid #14b8a6`, color: done ? 'white' : '#14b8a6' }}>
                      {done ? '✓' : '+'}
                    </button>
                  ) : (
                  <button onClick={() => toggleHabit(habit)}
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
                    style={{
                      background: done ? '#22c55e' : 'transparent',
                      border: done ? 'none' : `2px solid ${pColor}`,
                    }}>
                    {done && <span className="text-white text-xs font-bold">✓</span>}
                  </button>
                  )}

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

                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-bold" style={{ color: pColor }}>P{habit.priority}</span>
                      <span className="text-[10px] text-muted">{TIME_ICONS[habit.scheduledTime]} {habit.scheduledTime}</span>
                      <span className="text-[10px] text-muted capitalize">
                        {habit.frequency === 'weekly' && habit.weekDays.length
                          ? `${habit.weekDays.length}×/wk` : 'daily'}
                      </span>
                      {habit.currentStreak > 0 && (
                        <span className="text-[10px] text-muted">🔥 {habit.currentStreak}d streak</span>
                      )}
                      {atRisk && (
                        <span className="text-[10px]" style={{ color: '#f59e0b' }}>⚠️ at risk</span>
                      )}
                    </div>

                    {habit.why && (
                      <p className="text-[10px] mt-0.5 italic" style={{ color: 'var(--muted)' }}>
                        💡 {habit.why}
                      </p>
                    )}
                    {isCountHabit && (
                      <div className="mt-1.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: done ? '#22c55e' : '#14b8a6' }}>{habit.todayCount} / {habit.targetCount}</span>
                          <span className="text-[10px] text-muted">{Math.round(countPct)}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${countPct}%`, background: done ? '#22c55e' : '#14b8a6' }} />
                        </div>
                        <div className="flex gap-1 mt-1.5">
                          {[1, 5, 10].map(n => (
                            <button key={n} onClick={() => incrementCount(habit, n)}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-medium"
                              style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}>
                              +{n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <button onClick={() => setEditId(editId === habit.id ? null : habit.id)}
                    className="text-muted text-sm px-1 flex-shrink-0">⋯</button>
                </div>

                {/* ── Last 3 days + consistency bar ── */}
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    {(['2d ago', 'Yesterday', 'Today'] as const).map((label, i) => {
                      const val = habit.last3Days[i]
                      return (
                        <div key={label} className="flex flex-col items-center gap-0.5">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                            style={{
                              background: val === true ? '#22c55e' : val === false ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)',
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
                      habitType={editHabitType} setHabitType={setEditHabitType}
                      targetCount={editTargetCount} setTargetCount={setEditTargetCount}
                      aiLoading={editAiLoading}
                      onSuggestEmoji={() => fetchSuggestedEmoji(editName, true)}
                      onSave={saveEdit} onCancel={() => setEditingHabit(null)} saving={false}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>}
    </div>
  )
}
