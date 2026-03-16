'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  addDocument, queryDocuments, updateDocument, deleteDocument,
  updateUserDoc, todayDate, where, orderBy, limit
} from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'
import Link from 'next/link'

interface HabitLog { id: string; habitId: string; name: string; completed: boolean; priority: number; emoji?: string }
interface ActivityLog { id: string; text: string; mood: number | null; activityTag: string | null; timestamp: string; hour: number }
interface TodoItem { id: string; title: string; priority: number; category: string; completed: boolean }
interface Medication { id: string; name: string; dosage?: string; frequency: string }
interface DailyTask { id: string; title: string; targetCount: number; emoji: string; color: string }
interface HabitDot { date: string; done: number; total: number }
interface CounterSummary { id: string; name: string; emoji: string; currentCount: number; targetCount: number; color: string }

const MOOD_EMOJIS = ['😔', '😐', '🙂', '😊', '🚀']
const ACTIVITY_COLORS: Record<string, string> = {
  Morning: '#f59e0b', Eating: '#22c55e', Working: '#3b82f6',
  Exercise: '#ef4444', Commute: '#8b5cf6', Resting: '#6b7280',
  Learning: '#14b8a6', Social: '#ec4899', Home: '#f97316', 'Self-care': '#a78bfa',
}
const DAY_START = 6
const DAY_END = 23

export default function CommandCenterPage() {
  const { user } = useAuth()
  const date = todayDate()
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()

  // Day progress
  const dayStartMins = DAY_START * 60
  const dayEndMins = DAY_END * 60
  const totalMins = dayEndMins - dayStartMins
  const currentMins = hour * 60 + minute
  const elapsedMins = Math.max(0, Math.min(currentMins - dayStartMins, totalMins))
  const remainingMins = Math.max(0, totalMins - elapsedMins)
  const dayPct = Math.round((elapsedMins / totalMins) * 100)
  const urgencyColor = remainingMins < 120 ? '#ef4444' : remainingMins < 240 ? '#f59e0b' : '#14b8a6'
  const isMorning = hour >= 5 && hour < 13

  // Time of day label
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  // Form state
  const [weight, setWeight] = useState('')
  const [medsChecked, setMedsChecked] = useState(false)
  const [oneThing, setOneThing] = useState('')
  const [burnoutMode, setBurnoutMode] = useState(false)

  // Data state
  const [habits, setHabits] = useState<HabitLog[]>([])
  const [habitsDone, setHabitsDone] = useState<Set<string>>(new Set())
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [identityStatement, setIdentityStatement] = useState('')
  const [identityVotes, setIdentityVotes] = useState(0)
  const [p1Todos, setP1Todos] = useState<TodoItem[]>([])
  const [medications, setMedications] = useState<Medication[]>([])
  const [medsTaken, setMedsTaken] = useState<Set<string>>(new Set())
  const [todayStats, setTodayStats] = useState({ sleep: null as number | null, weight: null as number | null, screen: null as number | null, focus: 0 })
  const [xpToday, setXpToday] = useState(0)
  const [xpLevel, setXpLevel] = useState(1)

  // Daily tasks (repeating, resets each day)
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([])
  const [dailyTaskCounts, setDailyTaskCounts] = useState<Record<string, number>>({})
  const [showAddDailyTask, setShowAddDailyTask] = useState(false)
  const [newDailyTaskTitle, setNewDailyTaskTitle] = useState('')
  const [newDailyTaskTarget, setNewDailyTaskTarget] = useState('10')
  const [newDailyTaskEmoji, setNewDailyTaskEmoji] = useState('🎯')

  // Stats from history
  const [habitDots, setHabitDots] = useState<HabitDot[]>([])
  const [topCounters, setTopCounters] = useState<CounterSummary[]>([])
  const [todoStats, setTodoStats] = useState({ personal: 0, work: 0 })
  const [weeklyHabitPct, setWeeklyHabitPct] = useState<number | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)

  // AI brief
  const [aiBrief, setAiBrief] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)

  // UI
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  // Auto-load AI brief once all data is available
  useEffect(() => {
    if (dataLoaded && !aiLoaded && !aiLoading) {
      loadAiBrief()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded])

  async function loadData() {
    if (!user) return
    const { getUserDoc } = await import('@/lib/firebase/db')
    const userDoc = await getUserDoc(user.uid) as DocumentData | null
    if (userDoc) setIdentityStatement(userDoc.identityStatement ?? '')

    const [habitDocs, logs, todosDocs, medDocs, vitalsLogs, pomoDocs, xpDocs, xpEvents, sleepDocs, screenDocs] = await Promise.all([
      queryDocuments('habits', [where('userId', '==', user.uid), where('isActive', '==', true), orderBy('priority', 'asc')]),
      queryDocuments('daily_habit_logs', [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('todos', [where('userId', '==', user.uid), where('completed', '==', false), where('priority', '==', 1), orderBy('createdAt', 'asc'), limit(5)]),
      queryDocuments('medications', [where('userId', '==', user.uid), where('isActive', '==', true)]),
      queryDocuments('vitals_logs', [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('pomodoro_sessions', [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('user_xp', [where('userId', '==', user.uid)]),
      queryDocuments('xp_events', [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('sleep_logs', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(1)]),
      queryDocuments('screen_time_logs', [where('userId', '==', user.uid), where('date', '==', date)]),
    ])

    const doneSet = new Set(logs.map(l => l.habitId as string))
    setHabitsDone(doneSet)
    setIdentityVotes(doneSet.size)
    setHabits(habitDocs.map(h => ({ id: h.id, habitId: h.id, name: h.name, completed: doneSet.has(h.id), priority: h.priority ?? 2, emoji: h.emoji })))
    setP1Todos(todosDocs.map(t => ({ id: t.id, title: t.title, priority: t.priority, category: t.category, completed: false })))
    setMedications(medDocs.map(m => ({ id: m.id, name: m.name, dosage: m.dosage, frequency: m.frequency })))

    if (vitalsLogs.length > 0) {
      const taken = vitalsLogs[0].medsTaken ?? []
      setMedsTaken(new Set(taken))
    }

    if (xpDocs.length > 0) setXpLevel(xpDocs[0].level ?? 1)
    setXpToday(xpEvents.reduce((s: number, e: DocumentData) => s + (e.xpEarned ?? 0), 0))

    setTodayStats({
      sleep: sleepDocs[0]?.hoursSlept ?? null,
      weight: null,
      screen: screenDocs[0]?.minutesUsed ?? null,
      focus: pomoDocs.length,
    })

    // Activity logs
    const alDocs = await queryDocuments('activity_logs', [where('userId', '==', user.uid), where('date', '==', date)])
    setActivityLogs(alDocs.map(d => ({
      id: d.id, text: d.text ?? '', mood: d.mood ?? null,
      activityTag: d.activityTag ?? null,
      timestamp: typeof d.timestamp === 'string' ? d.timestamp : (d.timestamp?.toDate?.()?.toISOString?.() ?? new Date().toISOString()),
      hour: d.hour ?? 0,
    })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)))

    // Daily tasks
    const dtDocs = await queryDocuments('daily_tasks', [where('userId', '==', user.uid)])
    setDailyTasks(dtDocs.map(d => ({ id: d.id, title: d.title, targetCount: d.targetCount ?? 10, emoji: d.emoji ?? '🎯', color: d.color ?? '#14b8a6' })))

    const dtLogDocs = await queryDocuments('daily_task_logs', [where('userId', '==', user.uid), where('date', '==', date)])
    const counts: Record<string, number> = {}
    for (const l of dtLogDocs) counts[l.taskId] = (counts[l.taskId] ?? 0) + (l.count ?? 0)
    setDailyTaskCounts(counts)

    // 7-day summaries for habit dots + weekly avg
    const [summaries7d, counterDocs, pendingTodos] = await Promise.all([
      queryDocuments('daily_summaries', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(7)]),
      queryDocuments('custom_counters', [where('userId', '==', user.uid)]),
      queryDocuments('todos', [where('userId', '==', user.uid), where('completed', '==', false)]),
    ])

    const dots = summaries7d.slice(0, 7).reverse().map((s: DocumentData) => ({
      date: s.date as string,
      done: s.habitsDone ?? 0,
      total: s.habitsTotal ?? 0,
    }))
    setHabitDots(dots)

    const validDays = dots.filter(d => d.total > 0)
    if (validDays.length > 0) {
      const avg = validDays.reduce((s, d) => s + d.done / d.total, 0) / validDays.length
      setWeeklyHabitPct(Math.round(avg * 100))
    }

    setTopCounters(
      counterDocs
        .sort((a: DocumentData, b: DocumentData) =>
          (b.currentCount / Math.max(b.targetCount, 1)) - (a.currentCount / Math.max(a.targetCount, 1)))
        .slice(0, 3)
        .map((c: DocumentData) => ({
          id: c.id, name: c.name, emoji: c.emoji ?? '🎯',
          currentCount: c.currentCount ?? 0, targetCount: c.targetCount ?? 100,
          color: c.color ?? '#14b8a6',
        }))
    )

    setTodoStats({
      personal: pendingTodos.filter((t: DocumentData) => t.category === 'personal').length,
      work: pendingTodos.filter((t: DocumentData) => t.category === 'work').length,
    })

    setDataLoaded(true)
  }

  async function toggleHabit(habit: HabitLog) {
    if (!user) return
    const newDone = new Set(habitsDone)
    if (newDone.has(habit.habitId)) newDone.delete(habit.habitId)
    else {
      newDone.add(habit.habitId)
      await addDocument('xp_events', { userId: user.uid, date, eventType: 'habit', xpEarned: 10, description: `Completed habit: ${habit.name}` })
      setXpToday(prev => prev + 10)
    }
    setHabitsDone(newDone)
    setIdentityVotes(newDone.size)
    await addDocument('daily_habit_logs', { userId: user.uid, date, habitId: habit.habitId, completed: newDone.has(habit.habitId), completedAt: new Date().toISOString() })
  }

  async function toggleMed(medId: string) {
    if (!user) return
    const newSet = new Set(medsTaken)
    if (newSet.has(medId)) newSet.delete(medId)
    else newSet.add(medId)
    setMedsTaken(newSet)
    const existing = await queryDocuments('vitals_logs', [where('userId', '==', user.uid), where('date', '==', date)])
    if (existing.length > 0) {
      await updateDocument('vitals_logs', existing[0].id, { medsTaken: [...newSet] })
    } else {
      await addDocument('vitals_logs', { userId: user.uid, date, medsTaken: [...newSet] })
    }
  }

  async function incrementDailyTask(task: DailyTask, amount: number) {
    if (!user) return
    const cur = dailyTaskCounts[task.id] ?? 0
    const newCount = Math.min(cur + amount, task.targetCount)
    await addDocument('daily_task_logs', { userId: user.uid, taskId: task.id, date, count: amount })
    setDailyTaskCounts(prev => ({ ...prev, [task.id]: newCount }))
  }

  async function addDailyTask() {
    if (!user || !newDailyTaskTitle.trim()) return
    const doc = await addDocument('daily_tasks', {
      userId: user.uid, title: newDailyTaskTitle.trim(),
      targetCount: parseInt(newDailyTaskTarget) || 10,
      emoji: newDailyTaskEmoji, color: '#14b8a6',
    })
    setDailyTasks(prev => [...prev, { id: doc.id, title: newDailyTaskTitle.trim(), targetCount: parseInt(newDailyTaskTarget) || 10, emoji: newDailyTaskEmoji, color: '#14b8a6' }])
    setNewDailyTaskTitle(''); setNewDailyTaskTarget('10'); setShowAddDailyTask(false)
  }

  async function deleteDailyTask(id: string) {
    await deleteDocument('daily_tasks', id)
    setDailyTasks(prev => prev.filter(t => t.id !== id))
  }

  async function loadAiBrief() {
    if (!user || aiLoading) return
    setAiLoading(true)
    try {
      const completedTodayDocs = await queryDocuments('todos', [
        where('userId', '==', user.uid),
        where('completed', '==', true),
        where('completedAt', '>=', date),
      ])
      const res = await fetch('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          timeOfDay,
          habits: { done: habitsDone.size, total: habits.length },
          todos: { p1Pending: p1Todos.length, completedToday: completedTodayDocs.length },
          sleep: todayStats.sleep,
          focusSessions: todayStats.focus,
          weeklyHabitPct,
          xpLevel,
          xpToday,
          todoStats,
          topCounters: topCounters.map(c => ({
            name: c.name, currentCount: c.currentCount, targetCount: c.targetCount
          })),
        }),
      })
      const data = await res.json()
      setAiBrief(data.brief ?? '')
      setAiLoaded(true)
    } catch {
      setAiBrief("You're making progress — keep going!")
      setAiLoaded(true)
    }
    setAiLoading(false)
  }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const promises: Promise<unknown>[] = []
    if (weight) promises.push(addDocument('weight_logs', { userId: user.uid, date, weight: parseFloat(weight) }))
    promises.push(addDocument('daily_summaries', {
      userId: user.uid, date,
      weight: weight ? parseFloat(weight) : null,
      habitsDone: habitsDone.size, habitsTotal: habits.length,
      identityVotes: habitsDone.size,
      oneThing: oneThing || null, burnoutModeUsed: burnoutMode,
    }))
    promises.push(addDocument('xp_events', { userId: user.uid, date, eventType: 'command_center', xpEarned: 20, description: 'Saved Daily Command Center' }))
    await Promise.all(promises)
    setXpToday(prev => prev + 20)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const displayHabits = burnoutMode ? habits.filter(h => h.priority === 1).slice(0, 3) : habits
  const timelineHours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i)

  function formatRemaining() {
    if (remainingMins <= 0) return '⏰ Day is done — reflect & rest'
    if (remainingMins < 60) return `⏰ ${remainingMins}min left — finish strong!`
    const h = Math.floor(remainingMins / 60)
    const m = remainingMins % 60
    if (remainingMins < 120) return `🔥 ${h}h ${m}m left — make it count`
    if (remainingMins < 240) return `⚡ ${h}h ${m}m remaining`
    return `🌅 ${h}h left in your day`
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* ─── DAY PROGRESS ─── */}
      <div className="card" style={{ border: `1px solid ${urgencyColor}40` }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-muted">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: urgencyColor }}>{formatRemaining()}</p>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <p className="text-3xl font-bold leading-none" style={{ color: urgencyColor }}>{dayPct}%</p>
            <p className="text-[10px] text-muted mt-0.5">day used</p>
          </div>
        </div>
        <div className="relative w-full rounded-full h-4 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${dayPct}%`, background: `linear-gradient(90deg, #14b8a6, ${urgencyColor})` }} />
          {dayPct > 2 && dayPct < 98 && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-white opacity-80" style={{ left: `${dayPct}%` }} />
          )}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-muted">6 AM</span>
          <span className="text-[10px] font-medium" style={{ color: urgencyColor }}>
            {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-[10px] text-muted">11 PM</span>
        </div>
      </div>

      {/* ─── XP + STATS STRIP ─── */}
      <div className="grid grid-cols-4 gap-2">
        <Link href="/gamification" className="card-sm flex flex-col items-center justify-center text-center">
          <p className="text-xs text-muted">Level</p>
          <p className="text-xl font-bold" style={{ color: '#a855f7' }}>{xpLevel}</p>
          {xpToday > 0 && <p className="text-[9px]" style={{ color: '#a855f7' }}>+{xpToday} XP</p>}
        </Link>
        <div className="card-sm text-center">
          <p className="text-xs text-muted">😴 Sleep</p>
          <p className="text-lg font-bold" style={{ color: todayStats.sleep && todayStats.sleep < 6 ? '#ef4444' : '#818cf8' }}>
            {todayStats.sleep ?? '—'}
          </p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xs text-muted">📱 Screen</p>
          <p className="text-lg font-bold" style={{ color: todayStats.screen && todayStats.screen > 120 ? '#ef4444' : 'var(--foreground)' }}>
            {todayStats.screen ?? '—'}
          </p>
        </div>
        <div className="card-sm text-center">
          <p className="text-xs text-muted">🍅 Focus</p>
          <p className="text-lg font-bold" style={{ color: '#14b8a6' }}>{todayStats.focus}</p>
        </div>
      </div>

      {/* ─── 7-DAY HABIT STREAK ─── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">📈 This Week</h3>
          {weeklyHabitPct != null && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: weeklyHabitPct >= 70 ? 'rgba(34,197,94,0.15)' : weeklyHabitPct >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: weeklyHabitPct >= 70 ? '#22c55e' : weeklyHabitPct >= 40 ? '#f59e0b' : '#ef4444' }}>
              {weeklyHabitPct}% avg
            </span>
          )}
        </div>
        <div className="flex justify-between gap-1">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date()
            d.setDate(d.getDate() - (6 - i))
            const dStr = d.toISOString().split('T')[0]
            const dot = habitDots.find(h => h.date === dStr)
            const pct = dot?.total ? dot.done / dot.total : 0
            const dayLabel = d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)
            const isToday = dStr === date
            let bg = 'var(--surface-2)'
            if (pct >= 0.9) bg = '#22c55e'
            else if (pct >= 0.6) bg = '#86efac'
            else if (pct >= 0.3) bg = '#fcd34d'
            else if (dot) bg = '#fca5a5'
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                {dot && dot.total > 0 ? (
                  <span className="text-[9px] font-bold" style={{ color: pct >= 0.6 ? '#22c55e' : '#f59e0b' }}>
                    {dot.done}/{dot.total}
                  </span>
                ) : <span className="text-[9px]">&nbsp;</span>}
                <div className="w-full rounded-lg"
                  style={{ height: 28, background: bg, border: isToday ? '2px solid #14b8a6' : '1px solid var(--border)', opacity: dot ? 1 : 0.35 }} />
                <span className="text-[10px]" style={{ color: isToday ? '#14b8a6' : 'var(--muted)', fontWeight: isToday ? 600 : 400 }}>
                  {dayLabel}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 justify-end">
          {[['#22c55e', '90%+'], ['#86efac', '60%+'], ['#fcd34d', '30%+'], ['#fca5a5', '<30%']].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
              <span className="text-[9px] text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── AI MOTIVATIONAL BRIEF ─── */}
      <div className="card" style={{ border: '1px solid rgba(168,85,247,0.25)' }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">🤖 AI Coach</h3>
          <button onClick={loadAiBrief} disabled={aiLoading}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
            {aiLoading ? '⏳' : '↻ Refresh'}
          </button>
        </div>
        {aiLoading && !aiLoaded ? (
          <div className="flex items-center gap-2 py-2">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#a855f7' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#a855f7', animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#a855f7', animationDelay: '0.4s' }} />
            <span className="text-xs text-muted ml-1">Analysing your data...</span>
          </div>
        ) : aiLoaded ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>{aiBrief}</p>
        ) : (
          <p className="text-xs text-muted">
            {habitsDone.size}/{habits.length} habits · {p1Todos.length} P1 pending · {todayStats.focus} focus session{todayStats.focus !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ─── ONE THING ─── */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}>
        <span className="text-xl flex-shrink-0">⭐</span>
        <input type="text" value={oneThing} onChange={e => setOneThing(e.target.value)}
          placeholder="One must-do for today"
          className="flex-1 text-sm outline-none font-medium"
          style={{ background: 'transparent', color: '#818cf8' }} />
      </div>

      {/* ─── P1 TODOS ─── */}
      {p1Todos.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">🔴 Top Priority</h3>
            <Link href="/todos" className="text-xs" style={{ color: '#14b8a6' }}>See all →</Link>
          </div>
          <div className="space-y-2">
            {p1Todos.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#ef4444' }} />
                <span className="text-sm flex-1">{t.title}</span>
                <Link href="/now" className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>▶</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── TODO STATS ─── */}
      {(todoStats.personal > 0 || todoStats.work > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/todos?tab=personal" className="card-sm flex items-center gap-3 transition-opacity active:opacity-70">
            <span className="text-xl">👤</span>
            <div>
              <p className="text-xs text-muted">Personal</p>
              <p className="text-xl font-bold" style={{ color: todoStats.personal > 5 ? '#f59e0b' : 'var(--foreground)' }}>{todoStats.personal}</p>
              <p className="text-[10px] text-muted">open todos</p>
            </div>
          </Link>
          <Link href="/todos?tab=work" className="card-sm flex items-center gap-3 transition-opacity active:opacity-70">
            <span className="text-xl">💼</span>
            <div>
              <p className="text-xs text-muted">Work</p>
              <p className="text-xl font-bold" style={{ color: todoStats.work > 5 ? '#f59e0b' : 'var(--foreground)' }}>{todoStats.work}</p>
              <p className="text-[10px] text-muted">open todos</p>
            </div>
          </Link>
        </div>
      )}

      {/* ─── TOP COUNTERS ─── */}
      {topCounters.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">🎯 Counter Goals</h3>
            <Link href="/counters" className="text-xs" style={{ color: '#14b8a6' }}>See all →</Link>
          </div>
          <div className="space-y-3">
            {topCounters.map(c => {
              const pct = Math.min((c.currentCount / c.targetCount) * 100, 100)
              const done = c.currentCount >= c.targetCount
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{c.emoji} {c.name}</span>
                    <span className="text-xs font-bold" style={{ color: done ? '#22c55e' : c.color }}>
                      {c.currentCount} / {c.targetCount}
                    </span>
                  </div>
                  <div className="relative w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: done ? '#22c55e' : c.color }} />
                  </div>
                  <p className="text-[10px] text-muted mt-0.5 text-right">{Math.round(pct)}% complete</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── MEDICATIONS ─── */}
      {medications.length > 0 && (
        <section className="card">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">💊 Medications</h3>
          <div className="space-y-2">
            {medications.map(med => {
              const taken = medsTaken.has(med.id)
              return (
                <button key={med.id} onClick={() => toggleMed(med.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left"
                  style={{ background: taken ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)', border: taken ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)' }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold"
                    style={{ background: taken ? '#22c55e' : 'transparent', border: taken ? 'none' : '2px solid var(--border)', color: 'white' }}>
                    {taken ? '✓' : ''}
                  </span>
                  <span className="text-sm flex-1">{med.name}{med.dosage && ` · ${med.dosage}`}</span>
                  <span className="text-xs text-muted capitalize">{med.frequency}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── DAILY TASKS (repeating, resets each day) ─── */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">📋 Daily Tasks</h3>
          <button onClick={() => setShowAddDailyTask(!showAddDailyTask)}
            className="text-xs px-2.5 py-1 rounded-lg"
            style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>+ Add</button>
        </div>

        {showAddDailyTask && (
          <div className="mb-3 space-y-2 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <input type="text" value={newDailyTaskTitle} onChange={e => setNewDailyTaskTitle(e.target.value)}
              placeholder="e.g. Send 20 cold emails"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              autoFocus />
            <div className="flex gap-2">
              <input type="number" value={newDailyTaskTarget} onChange={e => setNewDailyTaskTarget(e.target.value)}
                placeholder="Target"
                className="w-20 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <div className="flex gap-1 flex-wrap">
                {['🎯', '📧', '📞', '📚', '💪', '✍️', '🏃', '💻'].map(e => (
                  <button key={e} onClick={() => setNewDailyTaskEmoji(e)}
                    className="w-8 h-8 rounded-lg text-lg flex items-center justify-center"
                    style={{ background: newDailyTaskEmoji === e ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)', border: newDailyTaskEmoji === e ? '2px solid #14b8a6' : '1px solid var(--border)' }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddDailyTask(false)} className="flex-1 py-2 rounded-xl text-xs" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
              <button onClick={addDailyTask} disabled={!newDailyTaskTitle.trim()} className="flex-1 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" style={{ background: '#14b8a6', color: 'white' }}>Add</button>
            </div>
          </div>
        )}

        {dailyTasks.length === 0 && !showAddDailyTask ? (
          <p className="text-xs text-muted">Add repeating daily tasks — e.g. &quot;Read 50 pages&quot;, &quot;Send 20 outreach emails&quot;</p>
        ) : (
          <div className="space-y-3">
            {dailyTasks.map(task => {
              const count = dailyTaskCounts[task.id] ?? 0
              const pct = Math.min((count / task.targetCount) * 100, 100)
              const done = count >= task.targetCount
              return (
                <div key={task.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{task.emoji}</span>
                    <span className="text-sm flex-1">{task.title}</span>
                    <span className="text-xs font-bold" style={{ color: done ? '#22c55e' : task.color }}>{count}/{task.targetCount}</span>
                    <button onClick={() => deleteDailyTask(task.id)} className="text-xs" style={{ color: 'var(--muted)' }}>✕</button>
                  </div>
                  <div className="w-full rounded-full h-1.5 mb-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: done ? '#22c55e' : task.color }} />
                  </div>
                  {!done && (
                    <div className="flex gap-2">
                      {[1, 5, 10].map(n => (
                        <button key={n} onClick={() => incrementDailyTask(task, n)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                          style={{ background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>
                          +{n}
                        </button>
                      ))}
                    </div>
                  )}
                  {done && <p className="text-xs text-center" style={{ color: '#22c55e' }}>✓ Done for today!</p>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── HABITS ─── */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2"><span>✅</span> Habits</h3>
          <span className="text-xs text-muted">{habitsDone.size}/{displayHabits.length} · {identityVotes} votes</span>
        </div>
        {habits.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted mb-3">No habits set up yet.</p>
            <Link href="/habits" className="text-sm font-medium px-4 py-2 rounded-xl" style={{ background: '#14b8a6', color: 'white' }}>Set up habits →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {displayHabits.map(habit => {
              const done = habitsDone.has(habit.habitId)
              return (
                <button key={habit.id} onClick={() => toggleHabit(habit)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                  style={{ background: done ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)', border: done ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)' }}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${done ? 'bg-green-500 text-white' : 'border-2'}`}
                    style={!done ? { borderColor: 'var(--border)' } : {}}>
                    {done ? '✓' : ''}
                  </span>
                  <span className="text-sm flex-1" style={{ color: done ? 'var(--muted)' : 'var(--foreground)', textDecoration: done ? 'line-through' : 'none' }}>
                    {habit.emoji && <span className="mr-1">{habit.emoji}</span>}{habit.name}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${habit.priority === 1 ? 'badge-p1' : 'badge-p2'}`}>P{habit.priority}</span>
                  {done && <span className="text-xs" style={{ color: '#22c55e' }}>+10</span>}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── ACTIVITY TIMELINE ─── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">📍 Today&apos;s Story</h3>
          <span className="text-xs text-muted">{activityLogs.length} moment{activityLogs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="flex gap-0.5" style={{ minWidth: `${timelineHours.length * 36}px` }}>
            {timelineHours.map(h => {
              const logsAtHour = activityLogs.filter(l => l.hour === h)
              const isCurrentHour = h === hour
              const isPast = h < hour
              return (
                <div key={h} className="flex flex-col items-center flex-1" style={{ minWidth: 34 }}>
                  <div className="h-14 flex flex-col items-center justify-end gap-0.5 mb-1 w-full">
                    {logsAtHour.slice(0, 2).map((log, i) => (
                      <div key={i} title={log.text || log.activityTag || ''}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[11px]"
                        style={{ background: log.activityTag ? `${ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6'}20` : 'rgba(20,184,166,0.12)', border: `1.5px solid ${log.activityTag ? ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6' : '#14b8a6'}` }}>
                        {log.mood ? MOOD_EMOJIS[log.mood - 1] : log.activityTag ? '•' : '💬'}
                      </div>
                    ))}
                    {logsAtHour.length > 2 && (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>+{logsAtHour.length - 2}</div>
                    )}
                  </div>
                  <div className="w-2 rounded-full transition-all"
                    style={{ height: logsAtHour.length > 0 ? 28 : isCurrentHour ? 20 : 8, background: isCurrentHour ? urgencyColor : logsAtHour.length > 0 ? '#14b8a6' : 'var(--surface-2)', opacity: isPast && !logsAtHour.length ? 0.3 : 1 }} />
                  <span className="text-[9px] mt-1 font-medium" style={{ color: isCurrentHour ? urgencyColor : 'var(--muted)' }}>
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        {activityLogs.length === 0 ? (
          <p className="text-xs text-muted text-center pt-2">Tap + to log what you&apos;re doing</p>
        ) : (
          <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
            {activityLogs.slice(-3).reverse().map(log => (
              <div key={log.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted flex-shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
                {log.mood && <span>{MOOD_EMOJIS[log.mood - 1]}</span>}
                {log.activityTag && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                    style={{ background: `${ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6'}20`, color: ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6' }}>
                    {log.activityTag}
                  </span>
                )}
                {log.text && <span className="text-muted truncate">{log.text}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── MORNING BLOCK ─── */}
      {!burnoutMode && (
        <section className="card">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><span>🌅</span> Morning</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xl w-8">⚖️</span>
              <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
                placeholder="Weight (kg)" step="0.1"
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <button onClick={() => setMedsChecked(!medsChecked)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm"
              style={{ background: medsChecked ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)', border: medsChecked ? '1px solid #14b8a6' : '1px solid var(--border)', color: medsChecked ? '#14b8a6' : 'var(--foreground)' }}>
              💊 All meds taken {medsChecked ? '✓' : ''}
            </button>
          </div>
        </section>
      )}

      {/* Burnout mode */}
      <div className="flex justify-end">
        <button onClick={() => setBurnoutMode(!burnoutMode)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
          style={{ background: burnoutMode ? 'rgba(99,102,241,0.15)' : 'var(--surface-2)', color: burnoutMode ? '#818cf8' : 'var(--muted)', border: '1px solid var(--border)' }}>
          {burnoutMode ? '🌙 Rest mode on' : '🌙 Burnout mode'}
        </button>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="w-full py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-50"
        style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white', boxShadow: '0 4px 15px rgba(20,184,166,0.3)' }}>
        {saving ? 'Saving...' : saved ? '✓ Saved! +20 XP' : burnoutMode ? '🌙 Save & rest' : '⚡ Save today\'s data'}
      </button>
    </div>
  )
}
