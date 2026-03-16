'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  addDocument, queryDocuments, updateDocument, deleteDocument,
  updateUserDoc, todayDate, where, orderBy, limit
} from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────
interface HabitRow { id: string; habitId: string; name: string; emoji?: string; priority: number; scheduledTime: string }
interface TodoItem  { id: string; title: string; priority: number; category: string }
interface Medication { id: string; name: string; dosage?: string; frequency: string }
interface CounterSummary { id: string; name: string; emoji: string; currentCount: number; targetCount: number; color: string }
interface HabitDot  { date: string; done: number; total: number }
interface PomodoroSession { taskText: string; durationMins: number; timestamp: string }
interface DailyTask { id: string; title: string; targetCount: number; emoji: string; color: string }

// ─── XP math ────────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 200
function xpProgress(xpTotal: number) {
  const level  = Math.floor(xpTotal / XP_PER_LEVEL) + 1
  const earned = xpTotal % XP_PER_LEVEL
  return { level, earned, needed: XP_PER_LEVEL }
}

const DAY_START = 6
const DAY_END   = 23

function getDateStr(daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

// ─── Tiny animated +XP pop-up ───────────────────────────────────────────────
function XpPop({ amount, onDone }: { amount: number; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1200); return () => clearTimeout(t) }, [])
  return (
    <span className="absolute -top-4 right-0 text-xs font-bold animate-bounce pointer-events-none z-10"
      style={{ color: '#a855f7' }}>+{amount} XP</span>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function CommandCenterPage() {
  const { user } = useAuth()
  const date = todayDate()

  // Live clock — updates every minute so day-progress recomputes
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const hour      = now.getHours()
  const minute    = now.getMinutes()
  const dayStart  = DAY_START * 60
  const dayEnd    = DAY_END   * 60
  const totalMins = dayEnd - dayStart
  const curMins   = hour * 60 + minute
  const elapsed   = Math.max(0, Math.min(curMins - dayStart, totalMins))
  const remaining = Math.max(0, totalMins - elapsed)
  const dayPct    = Math.round((elapsed / totalMins) * 100)
  const urgencyColor = remaining < 120 ? '#ef4444' : remaining < 240 ? '#f59e0b' : '#14b8a6'
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  // ── Data state ──
  const [habits, setHabits]     = useState<HabitRow[]>([])
  const [habitsDone, setHabitsDone] = useState<Set<string>>(new Set())
  const [p1Todos, setP1Todos]   = useState<TodoItem[]>([])
  const [todoStats, setTodoStats] = useState({ personal: 0, work: 0 })
  const [medications, setMedications] = useState<Medication[]>([])
  const [medsTaken, setMedsTaken] = useState<Set<string>>(new Set())
  const [todayStats, setTodayStats] = useState({ sleep: null as number | null, focus: 0 })
  const [xpToday, setXpToday]   = useState(0)
  const [xpTotal, setXpTotal]   = useState(0)
  const [habitDots, setHabitDots] = useState<HabitDot[]>([])
  const [weeklyHabitPct, setWeeklyHabitPct] = useState<number | null>(null)
  const [topCounters, setTopCounters] = useState<CounterSummary[]>([])
  const [focusSessions, setFocusSessions] = useState<PomodoroSession[]>([])
  const [focusStreak, setFocusStreak] = useState(0)
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([])
  const [dailyTaskCounts, setDailyTaskCounts] = useState<Record<string, number>>({})
  const [dataLoaded, setDataLoaded] = useState(false)

  // ── UI state ──
  const [oneThing, setOneThing] = useState('')
  const [weight, setWeight]     = useState('')
  const [burnoutMode, setBurnoutMode] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [xpPops, setXpPops]     = useState<{ id: number; amount: number; habitId: string }[]>([])
  const xpPopIdRef              = useRef(0)

  // ── AI state ──
  const [aiBrief, setAiBrief]   = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)

  // ── Daily tasks ──
  const [showAddDailyTask, setShowAddDailyTask] = useState(false)
  const [newDailyTaskTitle, setNewDailyTaskTitle] = useState('')
  const [newDailyTaskTarget, setNewDailyTaskTarget] = useState('10')
  const [newDailyTaskEmoji, setNewDailyTaskEmoji] = useState('🎯')

  // ── Auto-refresh every 5 minutes ──
  useEffect(() => {
    if (!user) return
    loadData()
    const t = setInterval(() => { loadData() }, 5 * 60_000)
    return () => clearInterval(t)
  }, [user])

  // Auto-load AI brief when data ready
  useEffect(() => {
    if (dataLoaded && !aiLoaded && !aiLoading) loadAiBrief()
  }, [dataLoaded])

  async function loadData() {
    if (!user) return
    const { getUserDoc } = await import('@/lib/firebase/db')
    const userDoc = await getUserDoc(user.uid) as DocumentData | null

    const [
      habitDocs, logDocs, todosDocs, medDocs, vitalsLogs,
      pomoDocs, xpDocs, xpEvents, sleepDocs, summaries7d,
      counterDocs, pendingTodos, dtDocs, dtLogDocs,
    ] = await Promise.all([
      queryDocuments('habits',          [where('userId', '==', user.uid), where('isActive', '==', true), orderBy('priority', 'asc')]),
      queryDocuments('daily_habit_logs',[where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('todos',           [where('userId', '==', user.uid), where('completed', '==', false), where('priority', '==', 1), orderBy('createdAt', 'asc'), limit(5)]),
      queryDocuments('medications',     [where('userId', '==', user.uid), where('isActive', '==', true)]),
      queryDocuments('vitals_logs',     [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('pomodoro_sessions',[where('userId', '==', user.uid), where('date', '==', date), orderBy('timestamp', 'desc')]),
      queryDocuments('user_xp',         [where('userId', '==', user.uid)]),
      queryDocuments('xp_events',       [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('sleep_logs',      [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(1)]),
      queryDocuments('daily_summaries', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(7)]),
      queryDocuments('custom_counters', [where('userId', '==', user.uid)]),
      queryDocuments('todos',           [where('userId', '==', user.uid), where('completed', '==', false)]),
      queryDocuments('daily_tasks',     [where('userId', '==', user.uid)]),
      queryDocuments('daily_task_logs', [where('userId', '==', user.uid), where('date', '==', date)]),
    ])

    const doneSet = new Set(logDocs.map(l => l.habitId as string))
    setHabitsDone(doneSet)
    setHabits(habitDocs.map(h => ({
      id: h.id, habitId: h.id, name: h.name, emoji: h.emoji,
      priority: h.priority ?? 2, scheduledTime: h.scheduledTime ?? 'anytime',
    })))
    setP1Todos(todosDocs.map(t => ({ id: t.id, title: t.title, priority: t.priority, category: t.category })))
    setMedications(medDocs.map(m => ({ id: m.id, name: m.name, dosage: m.dosage, frequency: m.frequency })))

    if (vitalsLogs.length > 0) setMedsTaken(new Set(vitalsLogs[0].medsTaken ?? []))

    const xpTotalVal = xpDocs[0]?.xpTotal ?? 0
    setXpTotal(xpTotalVal)
    const todayXp = xpEvents.reduce((s: number, e: DocumentData) => s + (e.xpEarned ?? 0), 0)
    setXpToday(todayXp)

    setTodayStats({ sleep: sleepDocs[0]?.hoursSlept ?? null, focus: pomoDocs.length })

    // Focus sessions today
    setFocusSessions(pomoDocs.slice(0, 6).map(d => ({
      taskText: d.taskText ?? 'Focus session',
      durationMins: d.durationMins ?? 25,
      timestamp: typeof d.timestamp === 'string' ? d.timestamp : (d.timestamp?.toDate?.()?.toISOString?.() ?? ''),
    })))

    // Focus streak: consecutive days with sessions
    const allPomoDocs = await queryDocuments('pomodoro_sessions', [
      where('userId', '==', user.uid), orderBy('date', 'desc'), limit(60),
    ])
    const focusDates = new Set(allPomoDocs.map((d: DocumentData) => d.date as string))
    let fs = 0
    for (let i = 0; i <= 60; i++) {
      if (focusDates.has(getDateStr(i))) fs++
      else if (i > 0) break
    }
    setFocusStreak(fs)

    // Habit dots
    const dots = summaries7d.slice(0, 7).reverse().map((s: DocumentData) => ({
      date: s.date as string, done: s.habitsDone ?? 0, total: s.habitsTotal ?? 0,
    }))
    setHabitDots(dots)
    const validDays = dots.filter((d: HabitDot) => d.total > 0)
    if (validDays.length > 0) {
      const avg = validDays.reduce((s: number, d: HabitDot) => s + d.done / d.total, 0) / validDays.length
      setWeeklyHabitPct(Math.round(avg * 100))
    }

    // Counters
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
      work:     pendingTodos.filter((t: DocumentData) => t.category === 'work').length,
    })

    // Daily tasks
    setDailyTasks(dtDocs.map(d => ({ id: d.id, title: d.title, targetCount: d.targetCount ?? 10, emoji: d.emoji ?? '🎯', color: d.color ?? '#14b8a6' })))
    const counts: Record<string, number> = {}
    for (const l of dtLogDocs) counts[l.taskId] = (counts[l.taskId] ?? 0) + (l.count ?? 0)
    setDailyTaskCounts(counts)

    setDataLoaded(true)
  }

  async function toggleHabit(habit: HabitRow) {
    if (!user) return
    const newDone = new Set(habitsDone)
    const wasDone = newDone.has(habit.habitId)
    if (wasDone) { newDone.delete(habit.habitId) }
    else {
      newDone.add(habit.habitId)
      await addDocument('xp_events', { userId: user.uid, date, eventType: 'habit', xpEarned: 10, description: `Completed: ${habit.name}` })
      setXpToday(p => p + 10)
      setXpTotal(p => p + 10)
      // Show XP pop-up
      const id = ++xpPopIdRef.current
      setXpPops(p => [...p, { id, amount: 10, habitId: habit.habitId }])
    }
    setHabitsDone(newDone)
    await addDocument('daily_habit_logs', { userId: user.uid, date, habitId: habit.habitId, completed: !wasDone, completedAt: new Date().toISOString() })
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
      const completedToday = await queryDocuments('todos', [
        where('userId', '==', user.uid), where('completed', '==', true), where('completedAt', '>=', date),
      ])
      const res = await fetch('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, timeOfDay,
          habits: { done: habitsDone.size, total: habits.length },
          todos: { p1Pending: p1Todos.length, completedToday: completedToday.length },
          sleep: todayStats.sleep, focusSessions: todayStats.focus,
          weeklyHabitPct, xpLevel: xpProgress(xpTotal).level,
          xpToday, todoStats,
          topCounters: topCounters.map(c => ({ name: c.name, currentCount: c.currentCount, targetCount: c.targetCount })),
        }),
      })
      const data = await res.json()
      setAiBrief(data.brief ?? '')
      setAiLoaded(true)
    } catch {
      setAiBrief("Focus on your top priority — that's the highest leverage action right now.")
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
      oneThing: oneThing || null,
    }))
    promises.push(addDocument('xp_events', { userId: user.uid, date, eventType: 'command_center', xpEarned: 20, description: 'Saved Daily Command Center' }))
    await Promise.all(promises)
    setXpToday(p => p + 20)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Derived ──
  const { level: xpLevel, earned: xpEarned, needed: xpNeeded } = xpProgress(xpTotal)
  const xpBarPct = Math.round((xpEarned / xpNeeded) * 100)
  const displayHabits = burnoutMode ? habits.filter(h => h.priority === 1).slice(0, 3) : habits
  const habitDoneCount = habitsDone.size
  const habitTotal = displayHabits.length
  const habitPct = habitTotal > 0 ? Math.round((habitDoneCount / habitTotal) * 100) : 0
  const habitRingColor = habitPct >= 80 ? '#22c55e' : habitPct >= 50 ? '#f59e0b' : '#ef4444'
  const focusTotalMins = focusSessions.reduce((s, f) => s + f.durationMins, 0)
  const isAllMedsTaken = medications.length > 0 && medsTaken.size === medications.length

  function formatRemaining() {
    if (remaining <= 0) return '⏰ Day is done — reflect & rest'
    if (remaining < 60)  return `⏰ ${remaining}min left`
    const h = Math.floor(remaining / 60), m = remaining % 60
    if (remaining < 120) return `🔥 ${h}h ${m}m — sprint!`
    return `${h}h ${m}m remaining`
  }

  // ── Greeting ──
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const greetingEmoji = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙'

  return (
    <div className="pb-6 space-y-4 animate-fade-in">

      {/* ═══════════════════════════════════════════════════════════
          1. HERO HEADER — Greeting + Day ring + XP bar
          Psychological: Identity-based framing + progress visibility
      ══════════════════════════════════════════════════════════════ */}
      <div className="card space-y-3" style={{ border: `1px solid ${urgencyColor}30` }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            <p className="text-lg font-bold mt-0.5">{greetingEmoji} {greeting}!</p>
            <p className="text-xs mt-0.5" style={{ color: urgencyColor }}>{formatRemaining()}</p>
          </div>
          {/* Day progress ring */}
          <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
              <circle cx="32" cy="32" r="26" fill="none" strokeWidth="5" stroke="var(--surface-2)" />
              <circle cx="32" cy="32" r="26" fill="none" strokeWidth="5"
                stroke={urgencyColor}
                strokeDasharray={`${2 * Math.PI * 26}`}
                strokeDashoffset={`${2 * Math.PI * 26 * (1 - dayPct / 100)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold leading-none" style={{ color: urgencyColor }}>{dayPct}%</span>
              <span className="text-[8px] text-muted">day</span>
            </div>
          </div>
        </div>

        {/* XP progress bar toward next level */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                Lv {xpLevel}
              </span>
              {xpToday > 0 && (
                <span className="text-xs" style={{ color: '#a855f7' }}>+{xpToday} today</span>
              )}
            </div>
            <span className="text-[10px] text-muted">{xpEarned}/{xpNeeded} XP</span>
          </div>
          <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${xpBarPct}%`, background: 'linear-gradient(90deg, #a855f7, #818cf8)' }} />
          </div>
        </div>

        {/* Sleep + Focus strip */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'var(--surface-2)' }}>
            <span className="text-base">😴</span>
            <div>
              <p className="text-[10px] text-muted">Sleep</p>
              <p className="text-sm font-bold" style={{ color: todayStats.sleep && todayStats.sleep < 6 ? '#ef4444' : '#818cf8' }}>
                {todayStats.sleep ? `${todayStats.sleep}h` : '—'}
              </p>
            </div>
          </div>
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: 'var(--surface-2)' }}>
            <span className="text-base">🍅</span>
            <div>
              <p className="text-[10px] text-muted">Focus</p>
              <p className="text-sm font-bold" style={{ color: '#14b8a6' }}>
                {todayStats.focus} {focusTotalMins > 0 && <span className="text-[10px] text-muted font-normal">({focusTotalMins}m)</span>}
              </p>
            </div>
          </div>
          <Link href="/now" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium text-xs"
            style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}>
            ▶ Focus
          </Link>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          2. AI COACH — loads automatically, contextual
          Psychological: Implementation intention / next-action framing
      ══════════════════════════════════════════════════════════════ */}
      <div className="card" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">🤖 AI Coach</h3>
          <button onClick={() => { setAiLoaded(false); loadAiBrief() }} disabled={aiLoading}
            className="text-[10px] px-2.5 py-1 rounded-lg disabled:opacity-40"
            style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
            {aiLoading ? '⏳' : '↻'}
          </button>
        </div>
        {aiLoading ? (
          <div className="flex items-center gap-1.5 py-1">
            {[0, 0.15, 0.3].map((d, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#a855f7', animationDelay: `${d}s` }} />
            ))}
            <span className="text-xs text-muted ml-1">Analysing your data…</span>
          </div>
        ) : aiLoaded ? (
          <p className="text-sm leading-relaxed">{aiBrief}</p>
        ) : (
          <p className="text-xs text-muted">Loading insights…</p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          3. ONE THING — Focused intention for today
          Psychological: Implementation intention
      ══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}>
        <span className="text-xl flex-shrink-0">⭐</span>
        <input type="text" value={oneThing} onChange={e => setOneThing(e.target.value)}
          placeholder="My one non-negotiable task today…"
          className="flex-1 text-sm font-medium outline-none"
          style={{ background: 'transparent', color: '#818cf8' }} />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          4. P1 TODOS — Highest psychological urgency
          Psychological: Cognitive load reduction — only top 5 shown
      ══════════════════════════════════════════════════════════════ */}
      {p1Todos.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">🔴 Must Do Today</h3>
            <Link href="/todos" className="text-xs" style={{ color: '#14b8a6' }}>All →</Link>
          </div>
          <div className="space-y-2">
            {p1Todos.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--surface-2)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#ef4444' }} />
                <span className="text-sm flex-1 leading-snug">{t.title}</span>
                <Link href="/now"
                  className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                  style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>▶</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Todo inbox counts */}
      {(todoStats.personal > 0 || todoStats.work > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { href: '/todos?tab=personal', icon: '👤', label: 'Personal', count: todoStats.personal },
            { href: '/todos?tab=work',     icon: '💼', label: 'Work',     count: todoStats.work },
          ].map(s => (
            <Link key={s.href} href={s.href}
              className="card-sm flex items-center gap-3 transition-opacity active:opacity-70">
              <span className="text-xl">{s.icon}</span>
              <div>
                <p className="text-xs text-muted">{s.label}</p>
                <p className="text-xl font-bold" style={{ color: s.count > 5 ? '#f59e0b' : 'var(--foreground)' }}>{s.count}</p>
                <p className="text-[10px] text-muted">open</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          5. HABITS — with progress ring + engagement loop
          Psychological: Variable reward (streak), progress visibility
      ══════════════════════════════════════════════════════════════ */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">✅ Habits</h3>
          <div className="flex items-center gap-2">
            {/* Habit completion ring */}
            <div className="relative" style={{ width: 36, height: 36 }}>
              <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5" stroke="var(--surface-2)" />
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5"
                  stroke={habitRingColor}
                  strokeDasharray={`${2 * Math.PI * 14}`}
                  strokeDashoffset={`${2 * Math.PI * 14 * (1 - habitPct / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
                style={{ color: habitRingColor }}>{habitPct}%</span>
            </div>
            <span className="text-xs text-muted">{habitDoneCount}/{habitTotal}</span>
            <Link href="/habits" className="text-xs" style={{ color: '#14b8a6' }}>Edit →</Link>
          </div>
        </div>

        {habits.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted mb-3">No habits set up yet.</p>
            <Link href="/habits" className="text-sm font-medium px-4 py-2 rounded-xl"
              style={{ background: '#14b8a6', color: 'white' }}>Set up habits →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {displayHabits.map(habit => {
              const done = habitsDone.has(habit.habitId)
              const pop  = xpPops.find(p => p.habitId === habit.habitId)
              return (
                <button key={habit.id} onClick={() => toggleHabit(habit)}
                  className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: done ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)',
                    border: done ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
                    transform: done ? 'none' : 'none',
                  }}>
                  {pop && <XpPop amount={pop.amount} onDone={() => setXpPops(p => p.filter(x => x.id !== pop.id))} />}
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${done ? '' : 'border-2'}`}
                    style={done
                      ? { background: '#22c55e', color: 'white' }
                      : { borderColor: habit.priority === 1 ? '#ef4444' : habit.priority === 2 ? '#f59e0b' : '#6b7280' }}>
                    {done ? '✓' : ''}
                  </span>
                  <span className="text-sm flex-1 leading-snug"
                    style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--muted)' : 'var(--foreground)' }}>
                    {habit.emoji && <span className="mr-1">{habit.emoji}</span>}{habit.name}
                  </span>
                  {done && <span className="text-xs font-bold" style={{ color: '#22c55e' }}>✓</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Habit completion celebration */}
        {habitTotal > 0 && habitDoneCount === habitTotal && (
          <div className="mt-3 text-center py-2 rounded-xl"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <p className="text-sm font-semibold" style={{ color: '#22c55e' }}>🎉 All habits done today! +10 XP each</p>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          6. 7-DAY HABIT STREAK — visual trend
          Psychological: Streak loss aversion (don't break the chain)
      ══════════════════════════════════════════════════════════════ */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">📈 This Week</h3>
          {weeklyHabitPct != null && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: weeklyHabitPct >= 70 ? 'rgba(34,197,94,0.15)' : weeklyHabitPct >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                color:      weeklyHabitPct >= 70 ? '#22c55e'              : weeklyHabitPct >= 40 ? '#f59e0b'               : '#ef4444',
              }}>
              {weeklyHabitPct}% avg
            </span>
          )}
        </div>
        <div className="flex justify-between gap-1">
          {Array.from({ length: 7 }).map((_, i) => {
            const d    = new Date(); d.setDate(d.getDate() - (6 - i))
            const dStr = d.toISOString().split('T')[0]
            const dot  = habitDots.find(h => h.date === dStr)
            const pct  = dot?.total ? dot.done / dot.total : 0
            const dayLabel = d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)
            const isToday  = dStr === date
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
                <span className="text-[10px]"
                  style={{ color: isToday ? '#14b8a6' : 'var(--muted)', fontWeight: isToday ? 600 : 400 }}>
                  {dayLabel}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          7. COUNTER GOALS — progress toward commitments
      ══════════════════════════════════════════════════════════════ */}
      {topCounters.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">🎯 Counter Goals</h3>
            <Link href="/counters" className="text-xs" style={{ color: '#14b8a6' }}>All →</Link>
          </div>
          <div className="space-y-3">
            {topCounters.map(c => {
              const pct  = Math.min((c.currentCount / c.targetCount) * 100, 100)
              const done = c.currentCount >= c.targetCount
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{c.emoji} {c.name}</span>
                    <span className="text-xs font-bold" style={{ color: done ? '#22c55e' : c.color }}>
                      {c.currentCount}/{c.targetCount}
                    </span>
                  </div>
                  <div className="relative w-full rounded-full h-2.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: done ? '#22c55e' : c.color }} />
                  </div>
                  <p className="text-[10px] text-muted mt-0.5 text-right">{Math.round(pct)}%{done ? ' ✓ Complete!' : ''}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════
          8. DAILY TASKS — repeating counters
      ══════════════════════════════════════════════════════════════ */}
      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">📋 Daily Tasks</h3>
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
              const pct   = Math.min((count / task.targetCount) * 100, 100)
              const done  = count >= task.targetCount
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

      {/* ═══════════════════════════════════════════════════════════
          9. MEDICATIONS CHECKLIST
      ══════════════════════════════════════════════════════════════ */}
      {medications.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">💊 Medications</h3>
            {isAllMedsTaken && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                All taken ✓
              </span>
            )}
          </div>
          <div className="space-y-2">
            {medications.map(med => {
              const taken = medsTaken.has(med.id)
              return (
                <button key={med.id} onClick={() => toggleMed(med.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: taken ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)',
                    border: taken ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
                  }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold transition-all"
                    style={taken
                      ? { background: '#22c55e', color: 'white' }
                      : { border: '2px solid var(--border)', color: 'transparent' }}>
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

      {/* ═══════════════════════════════════════════════════════════
          10. FOCUS SESSIONS TODAY
      ══════════════════════════════════════════════════════════════ */}
      {focusSessions.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              🍅 Focus Sessions
              {focusStreak > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🔥 {focusStreak}d streak</span>}
            </h3>
            <Link href="/now" className="text-xs" style={{ color: '#14b8a6' }}>+ Session →</Link>
          </div>
          <div className="space-y-2">
            {focusSessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: 'var(--surface-2)' }}>
                <span className="text-base">🍅</span>
                <p className="text-sm flex-1 truncate">{s.taskText}</p>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>{s.durationMins}m</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════
          11. MORNING LOG — weight + burnout mode
      ══════════════════════════════════════════════════════════════ */}
      {!burnoutMode && (
        <section className="card">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">🌅 Morning Log</h3>
          <div className="flex items-center gap-3">
            <span className="text-xl w-8">⚖️</span>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
              placeholder="Weight today (kg)" step="0.1"
              className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
        </section>
      )}

      {/* Burnout mode toggle */}
      <div className="flex justify-end">
        <button onClick={() => setBurnoutMode(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
          style={{
            background: burnoutMode ? 'rgba(99,102,241,0.15)' : 'var(--surface-2)',
            color: burnoutMode ? '#818cf8' : 'var(--muted)',
            border: '1px solid var(--border)',
          }}>
          {burnoutMode ? '🌙 Rest mode on' : '🌙 Burnout mode'}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          12. SAVE — completes the daily loop (+20 XP)
      ══════════════════════════════════════════════════════════════ */}
      <button onClick={handleSave} disabled={saving}
        className="w-full py-4 rounded-2xl font-semibold text-sm disabled:opacity-50"
        style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white', boxShadow: '0 4px 15px rgba(20,184,166,0.3)' }}>
        {saving ? 'Saving…' : saved ? '✓ Saved! +20 XP' : burnoutMode ? '🌙 Save & rest' : '⚡ Save today\'s data'}
      </button>

    </div>
  )
}
