'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  addDocument, queryDocuments, updateDocument,
  updateUserDoc, todayDate, where, orderBy, limit
} from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'
import Link from 'next/link'
import { calcLevel, xpToNextLevel, xpInCurrentLevel } from '@/lib/xp'

// ─── Types ──────────────────────────────────────────────────────────────────
interface HabitRow { id: string; habitId: string; name: string; emoji?: string; priority: number; scheduledTime: string }
interface TodoItem  { id: string; title: string; priority: number; category: string }
interface Medication { id: string; name: string; dosage?: string; frequency: string }
interface CounterSummary { id: string; name: string; emoji: string; currentCount: number; targetCount: number; color: string }
interface HabitDot  { date: string; done: number; total: number }
interface PomodoroSession { taskText: string; durationMins: number; timestamp: string }
interface NextAction { title: string; type: 'habit' | 'todo' | 'counter' | 'focus'; reason: string; urgency: 'high' | 'medium' | 'low' }
interface GoalSummary { id: string; title: string; currentValue: number; targetValue: number; startValue: number; deadline?: string }

// ─── XP math (uses shared lib/xp.ts) ────────────────────────────────────────
function xpProgress(xpTotal: number) {
  const level  = calcLevel(xpTotal)
  const earned = xpInCurrentLevel(xpTotal)
  const needed = xpToNextLevel(level)
  return { level, earned, needed }
}

const DAY_START = 0
const DAY_END   = 24

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
  const [xpDocId, setXpDocId]   = useState<string | null>(null)
  const [habitDots, setHabitDots] = useState<HabitDot[]>([])
  const [weeklyHabitPct, setWeeklyHabitPct] = useState<number | null>(null)
  const [topCounters, setTopCounters] = useState<CounterSummary[]>([])
  const [focusSessions, setFocusSessions] = useState<PomodoroSession[]>([])
  const [focusStreak, setFocusStreak] = useState(0)
  const [dueTodayTodos, setDueTodayTodos] = useState<TodoItem[]>([])
  const [aiNextActions, setAiNextActions] = useState<NextAction[]>([])
  const [aiNextLoading, setAiNextLoading] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [foodStats, setFoodStats] = useState({ calories: 0, protein: 0 })
  const [oneThingTodoId, setOneThingTodoId] = useState('')
  const [activeGoals, setActiveGoals] = useState<GoalSummary[]>([])
  // Correlation Engine
  interface Correlation { title: string; finding: string; action: string; strength: 'strong'|'moderate'|'weak'; trackers: string[] }
  const [correlations, setCorrelations] = useState<Correlation[]>([])
  const [correlationsLoading, setCorrelationsLoading] = useState(false)
  const [correlationsLoaded, setCorrelationsLoaded] = useState(false)

  // ── UI state ──
  const [oneThing, setOneThing] = useState('')
  const [weight, setWeight]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [xpPops, setXpPops]     = useState<{ id: number; amount: number; habitId: string }[]>([])
  const xpPopIdRef              = useRef(0)
  // Time-of-day habit filter — default to current time slice
  const defaultFilter = (() => { if (hour < 12) return 'morning'; if (hour < 17) return 'afternoon'; return 'evening' })()
  const [habitTimeFilter, setHabitTimeFilter] = useState<'all' | 'morning' | 'afternoon' | 'evening'>(defaultFilter as 'morning' | 'afternoon' | 'evening')
  // Last week habit stats for delta
  const [lastWeekHabitPct, setLastWeekHabitPct] = useState<number | null>(null)

  // ── Auto-refresh every 5 minutes ──
  useEffect(() => {
    if (!user) return
    loadData()
    const t = setInterval(() => { loadData() }, 5 * 60_000)
    return () => clearInterval(t)
  }, [user])

  async function loadData() {
    if (!user) return
    const { getUserDoc } = await import('@/lib/firebase/db')
    const userDoc = await getUserDoc(user.uid) as DocumentData | null

    const [
      habitDocs, logDocs, todosDocs, medDocs, vitalsLogs,
      pomoDocs, xpDocs, xpEvents, sleepDocs,
      counterDocs, pendingTodos, dueTodayDocs,
      foodLogs, weekHabitLogs, goalDocs,
    ] = await Promise.all([
      queryDocuments('habits',          [where('userId', '==', user.uid), where('isActive', '==', true), orderBy('priority', 'asc')]),
      queryDocuments('daily_habit_logs',[where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('todos',           [where('userId', '==', user.uid), where('completed', '==', false), where('priority', '==', 1), orderBy('createdAt', 'asc'), limit(10)]),
      queryDocuments('medications',     [where('userId', '==', user.uid), where('isActive', '==', true)]),
      queryDocuments('vitals_logs',     [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('pomodoro_sessions',[where('userId', '==', user.uid), where('date', '==', date), orderBy('timestamp', 'desc')]),
      queryDocuments('user_xp',         [where('userId', '==', user.uid)]),
      queryDocuments('xp_events',       [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('sleep_logs',      [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(1)]),
      queryDocuments('custom_counters', [where('userId', '==', user.uid)]),
      queryDocuments('todos',           [where('userId', '==', user.uid), where('completed', '==', false)]),
      queryDocuments('todos',           [where('userId', '==', user.uid), where('completed', '==', false), where('dueDate', '==', date)]),
      queryDocuments('food_logs',       [where('userId', '==', user.uid), where('date', '==', date)]),
      queryDocuments('daily_habit_logs',[where('userId', '==', user.uid), orderBy('date', 'desc'), limit(300)]),
      queryDocuments('goals',           [where('userId', '==', user.uid), where('status', '==', 'active')]),
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
    if (xpDocs[0]?.id) setXpDocId(xpDocs[0].id)
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

    // Habit dots — built directly from daily_habit_logs (not daily_summaries)
    const habitCount = habitDocs.length
    const dots: HabitDot[] = Array.from({ length: 7 }).map((_, i) => {
      const dStr = getDateStr(6 - i)
      const dayLogs = (weekHabitLogs as DocumentData[]).filter(l => l.date === dStr)
      const done    = dayLogs.filter(l => l.completed === true).length
      return { date: dStr, done, total: habitCount }
    })
    setHabitDots(dots)
    const validDays = dots.filter(d => d.total > 0 && d.done > 0)
    if (validDays.length > 0) {
      const avg = validDays.reduce((s, d) => s + d.done / d.total, 0) / dots.filter(d => d.total > 0).length
      setWeeklyHabitPct(Math.round(avg * 100))
    }

    // Food stats for today
    const totCals    = (foodLogs as DocumentData[]).reduce((s, f) => s + (f.calories ?? 0), 0)
    const totProtein = (foodLogs as DocumentData[]).reduce((s, f) => s + (f.protein   ?? 0), 0)
    setFoodStats({ calories: Math.round(totCals), protein: Math.round(totProtein) })

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

    // Due today todos (exclude ones already in P1 list)
    setDueTodayTodos(
      dueTodayDocs
        .filter((t: DocumentData) => t.priority !== 1)
        .slice(0, 5)
        .map((t: DocumentData) => ({ id: t.id, title: t.title, priority: t.priority, category: t.category }))
    )

    // Active goals (sorted by nearest deadline then by progress)
    setActiveGoals(
      (goalDocs as DocumentData[])
        .map(g => ({
          id: g.id, title: g.title,
          currentValue: g.currentValue ?? g.startValue ?? 0,
          targetValue: g.targetValue ?? 100,
          startValue: g.startValue ?? 0,
          deadline: g.deadline,
        }))
        .sort((a, b) => {
          if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline)
          if (a.deadline) return -1
          if (b.deadline) return 1
          return 0
        })
        .slice(0, 3)
    )

    // Last week habit avg (days 7-13 ago)
    const lastWeekLogs = await queryDocuments('daily_habit_logs', [
      where('userId', '==', user.uid), orderBy('date', 'desc'), limit(500),
    ])
    const last7to13 = Array.from({ length: 7 }).map((_, i) => getDateStr(7 + i))
    const lwByDay = last7to13.map(dStr => {
      const dayLogs = (lastWeekLogs as DocumentData[]).filter(l => l.date === dStr)
      const done = dayLogs.filter(l => l.completed === true).length
      return { done, total: habitDocs.length }
    })
    const lwValid = lwByDay.filter(d => d.total > 0 && d.done > 0)
    if (lwValid.length > 0) {
      const avg = lwValid.reduce((s, d) => s + d.done / d.total, 0) / lwByDay.filter(d => d.total > 0).length
      setLastWeekHabitPct(Math.round(avg * 100))
    }

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
      setXpTotal(p => {
        const newTotal = p + 10
        // Persist to Firestore
        if (xpDocId) {
          updateDocument('user_xp', xpDocId, { xpTotal: newTotal })
        } else {
          addDocument('user_xp', { userId: user.uid, xpTotal: newTotal }).then(doc => {
            if (doc?.id) setXpDocId(doc.id)
          }).catch(() => {})
        }
        return newTotal
      })
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

  async function loadNextActions() {
    if (!user || aiNextLoading) return
    setAiNextLoading(true)
    try {
      const pendingHabits = habits.filter(h => !habitsDone.has(h.habitId))
      const res = await fetch('/api/ai/next-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          habits: pendingHabits.map(h => ({ name: h.name, priority: h.priority, scheduledTime: h.scheduledTime, completionRate7d: 75, done: false })),
          todos: p1Todos.map(t => ({ title: t.title, priority: t.priority, category: t.category, dueToday: false })),
          dueTodos: dueTodayTodos.map(t => ({ title: t.title, priority: t.priority, category: t.category, dueToday: true })),
          counters: topCounters.map(c => ({ name: c.name, currentCount: c.currentCount, targetCount: c.targetCount })),
          timeOfDay,
          focusDone: todayStats.focus,
          habitsDone: habitsDone.size,
          habitsTotal: habits.length,
        }),
      })
      const data = await res.json()
      setAiNextActions(data.actions ?? [])
    } catch {
      setAiNextActions([])
    }
    setAiNextLoading(false)
  }

  async function loadCorrelations() {
    if (!user || correlationsLoading) return
    setCorrelationsLoading(true)
    try {
      const [sleepDocs, allHabitLogs, cravingDocs, allFoodLogs] = await Promise.all([
        queryDocuments('sleep_logs', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(30)]),
        queryDocuments('daily_habit_logs', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(500)]),
        queryDocuments('bad_habit_logs', [where('userId', '==', user.uid), orderBy('timestamp', 'desc'), limit(100)]),
        queryDocuments('food_logs', [where('userId', '==', user.uid), orderBy('date', 'desc'), limit(100)]),
      ])
      const res = await fetch('/api/ai/correlations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          sleepLogs: sleepDocs,
          habitLogs: allHabitLogs,
          cravingLogs: cravingDocs,
          foodLogs: allFoodLogs,
        }),
      })
      const data = await res.json()
      setCorrelations(data.correlations ?? [])
      setCorrelationsLoaded(true)
    } catch { setCorrelations([]) }
    setCorrelationsLoading(false)
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
    const newTotal = xpTotal + 20
    if (xpDocId) {
      await updateDocument('user_xp', xpDocId, { xpTotal: newTotal })
    } else {
      const ref = await addDocument('user_xp', { userId: user.uid, xpTotal: newTotal })
      if (ref?.id) setXpDocId(ref.id)
    }
    setXpTotal(newTotal)
    setXpToday(p => p + 20)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── Derived ──
  const { level: xpLevel, earned: xpEarned, needed: xpNeeded } = xpProgress(xpTotal)
  const xpBarPct = Math.round((xpEarned / xpNeeded) * 100)
  // Time-filtered habits — only show relevant time-of-day; done habits shown separately as muted ticks
  const pendingHabits = habits.filter(h => !habitsDone.has(h.habitId) &&
      (habitTimeFilter === 'all' || h.scheduledTime === 'anytime' || h.scheduledTime === habitTimeFilter))
  const doneHabitsFiltered = habits.filter(h => habitsDone.has(h.habitId) &&
    (habitTimeFilter === 'all' || h.scheduledTime === 'anytime' || h.scheduledTime === habitTimeFilter))
  const displayHabits = pendingHabits
  // Delta vs last week
  const habitDelta = weeklyHabitPct !== null && lastWeekHabitPct !== null
    ? weeklyHabitPct - lastWeekHabitPct : null
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
    <div className="pb-6 animate-fade-in space-y-4">

      {/* ════════════════════════════════════════════════════
          Responsive 2-column layout on desktop
          Left: primary interactions | Right: context & AI
      ════════════════════════════════════════════════════ */}
      <div className="desktop-two-col">

        {/* ── LEFT COLUMN ─────────────────────────────────── */}
        <div className="space-y-4">

          {/* 1. HERO HEADER */}
          <div className="card space-y-3" style={{ border: `1px solid ${urgencyColor}30` }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted">
                  {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                </p>
                <p className="text-lg font-bold mt-0.5">{greetingEmoji} {greeting}!</p>
                <p className="text-xs mt-0.5" style={{ color: urgencyColor }}>{formatRemaining()}</p>
              </div>
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

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                    Lv {xpLevel}
                  </span>
                  {xpToday > 0 && <span className="text-xs" style={{ color: '#a855f7' }}>+{xpToday} today</span>}
                </div>
                <span className="text-[10px] text-muted">{xpEarned}/{xpNeeded} XP</span>
              </div>
              <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${xpBarPct}%`, background: 'linear-gradient(90deg, #a855f7, #818cf8)' }} />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <span className="text-base">😴</span>
                <div>
                  <p className="text-[10px] text-muted">Sleep</p>
                  <p className="text-sm font-bold" style={{ color: todayStats.sleep && todayStats.sleep < 6 ? '#ef4444' : '#818cf8' }}>
                    {todayStats.sleep ? `${todayStats.sleep}h` : '—'}
                  </p>
                </div>
              </div>
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <span className="text-base">🍅</span>
                <div>
                  <p className="text-[10px] text-muted">Focus</p>
                  <p className="text-sm font-bold" style={{ color: '#14b8a6' }}>
                    {todayStats.focus}{focusTotalMins > 0 && <span className="text-[10px] text-muted font-normal"> ({focusTotalMins}m)</span>}
                  </p>
                </div>
              </div>
              <Link href="/now" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium text-xs"
                style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}>
                ▶ Focus
              </Link>
            </div>
          </div>

          {/* 2. NORTH STAR GOALS */}
          {activeGoals.length > 0 && (
            <div className="card" style={{ border: '1px solid rgba(251,191,36,0.3)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-1.5">🎯 Your North Star</h3>
                <Link href="/goals" className="text-[10px] px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(251,191,36,0.1)', color: '#f59e0b' }}>
                  All goals →
                </Link>
              </div>
              <div className="space-y-3">
                {activeGoals.slice(0, 2).map(goal => {
                  const range = Math.abs(goal.targetValue - goal.startValue)
                  const progress = range > 0 ? Math.abs(goal.currentValue - goal.startValue) / range : 0
                  const pct = Math.round(Math.min(progress, 1) * 100)
                  const daysLeft = goal.deadline
                    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000)
                    : null
                  return (
                    <div key={goal.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate flex-1 mr-2">{goal.title}</p>
                        <span className="text-xs font-bold flex-shrink-0" style={{ color: '#f59e0b' }}>{pct}%</span>
                      </div>
                      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #f59e0b, #fbbf24)' }} />
                      </div>
                      {daysLeft !== null && (
                        <p className="text-[10px] text-muted">
                          {daysLeft > 0 ? `${daysLeft}d until deadline` : daysLeft === 0 ? '⚠️ Due today' : `${Math.abs(daysLeft)}d overdue`}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 3. ONE THING — pick from P1 todos */}
          <div className="px-4 py-3 rounded-xl space-y-2"
            style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.25)' }}>
            <div className="flex items-center gap-2">
              <span className="text-lg flex-shrink-0">⭐</span>
              <span className="text-xs font-semibold" style={{ color: '#818cf8' }}>One Non-Negotiable Today</span>
            </div>
            {p1Todos.length > 0 ? (
              <select
                value={oneThingTodoId || '__custom__'}
                onChange={e => {
                  const val = e.target.value
                  setOneThingTodoId(val === '__custom__' ? '' : val)
                  if (val !== '__custom__') {
                    const t = p1Todos.find(t => t.id === val)
                    setOneThing(t?.title ?? '')
                  } else {
                    setOneThing('')
                  }
                }}
                className="w-full px-3 py-2 rounded-xl text-sm font-medium outline-none"
                style={{ background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.4)', color: '#818cf8' }}>
                <option value="__custom__">— Choose a P1 todo —</option>
                {p1Todos.map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            ) : (
              <input type="text" value={oneThing} onChange={e => setOneThing(e.target.value)}
                placeholder="No P1 todos — type your one thing…"
                className="w-full px-3 py-2 rounded-xl text-sm font-medium outline-none"
                style={{ background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.4)', color: '#818cf8' }} />
            )}
            {oneThingTodoId && oneThing && (
              <p className="text-[10px]" style={{ color: '#818cf8' }}>✓ {oneThing}</p>
            )}
          </div>

          {/* 4. P1 TODOS */}
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
                    <Link href="/now" className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
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

          {/* 5. HABITS */}
          <section className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">✅ Habits</h3>
              <div className="flex items-center gap-2">
                <div className="relative" style={{ width: 36, height: 36 }}>
                  <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5" stroke="var(--surface-2)" />
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5"
                      stroke={habitRingColor}
                      strokeDasharray={`${2 * Math.PI * 14}`}
                      strokeDashoffset={`${2 * Math.PI * 14 * (1 - (habitsDone.size / Math.max(habits.length, 1)) * 100 / 100)}`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
                    style={{ color: habitRingColor }}>{Math.round((habitsDone.size / Math.max(habits.length, 1)) * 100)}%</span>
                </div>
                <span className="text-xs text-muted">{habitsDone.size}/{habits.length}</span>
                {habitDelta !== null && (
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: habitDelta >= 0 ? '#22c55e' : '#ef4444', background: habitDelta >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 99, padding: '1px 6px' }}>
                    {habitDelta >= 0 ? '+' : ''}{habitDelta}%
                  </span>
                )}
                <Link href="/habits" className="text-xs" style={{ color: '#14b8a6' }}>Edit →</Link>
              </div>
            </div>

            {/* Time-of-day filter pills */}
            {habits.length > 0 && (
              <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.75rem', overflowX: 'auto' }}>
                {(['all', 'morning', 'afternoon', 'evening'] as const).map(f => {
                  const icons: Record<string, string> = { all: '🌐', morning: '🌅', afternoon: '☀️', evening: '🌙' }
                  const counts = f === 'all'
                    ? habits.filter(h => !habitsDone.has(h.habitId)).length
                    : habits.filter(h => !habitsDone.has(h.habitId) && (h.scheduledTime === f || h.scheduledTime === 'anytime')).length
                  return (
                    <button key={f} onClick={() => setHabitTimeFilter(f)}
                      style={{
                        padding: '3px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
                        background: habitTimeFilter === f ? 'var(--color-primary)' : 'var(--surface-2)',
                        color: habitTimeFilter === f ? '#fff' : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}>
                      {icons[f]} {f.charAt(0).toUpperCase() + f.slice(1)} {counts > 0 ? `(${counts})` : ''}
                    </button>
                  )
                })}
              </div>
            )}

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
                      className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                      style={{
                        background: done ? 'rgba(34,197,94,0.08)' : 'var(--surface-2)',
                        border: done ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
                        transition: 'background 0.25s, border 0.25s, transform 0.1s',
                      }}>
                      {pop && <XpPop amount={pop.amount} onDone={() => setXpPops(p => p.filter(x => x.id !== pop.id))} />}
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0`}
                        style={done
                          ? { background: '#22c55e', color: 'white', boxShadow: '0 0 8px rgba(34,197,94,0.5)' }
                          : { border: `2px solid ${habit.priority === 1 ? '#ef4444' : habit.priority === 2 ? '#f59e0b' : '#6b7280'}` }}>
                        {done ? '✓' : ''}
                      </span>
                      <span className="text-sm flex-1 leading-snug" style={{ color: done ? '#22c55e' : 'var(--foreground)', fontWeight: done ? 600 : 400 }}>
                        {habit.emoji && <span className="mr-1">{habit.emoji}</span>}{habit.name}
                      </span>
                      {done && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>done ✓</span>}
                    </button>
                  )
                })}
                {/* Completed habits — show as compact ticks */}
                {doneHabitsFiltered.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>COMPLETED ({doneHabitsFiltered.length})</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {doneHabitsFiltered.map(h => (
                        <button key={h.id} onClick={() => toggleHabit(h)}
                          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 99, padding: '2px 10px', fontSize: '0.72rem', color: '#22c55e', cursor: 'pointer', fontWeight: 500 }}>
                          ✓ {h.emoji} {h.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {habits.length > 0 && habitsDone.size === habits.length && (
              <div className="mt-3 text-center py-2 rounded-xl"
                style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <p className="text-sm font-semibold" style={{ color: '#22c55e' }}>🎉 All habits done today! +10 XP each</p>
              </div>
            )}
          </section>

        </div>{/* end LEFT column */}

        {/* ── RIGHT COLUMN ─────────────────────────────────── */}
        <div className="space-y-4 mt-4 lg:mt-0">

          {/* 7. AI NEXT 5 ACTIONS */}
          <section className="card" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">⚡ Do This Next</h3>
              <button onClick={loadNextActions} disabled={aiNextLoading}
                className="text-xs px-2.5 py-1 rounded-lg disabled:opacity-40"
                style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                {aiNextLoading ? '⏳' : '↻ Refresh'}
              </button>
            </div>
            {aiNextLoading ? (
              <div className="flex items-center gap-1.5 py-2">
                {[0, 0.15, 0.3].map((d, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#14b8a6', animationDelay: `${d}s` }} />
                ))}
                <span className="text-xs text-muted ml-1">AI is thinking…</span>
              </div>
            ) : aiNextActions.length > 0 ? (
              <div className="space-y-2">
                {aiNextActions.map((action, i) => {
                  const uColor = action.urgency === 'high' ? '#ef4444' : action.urgency === 'medium' ? '#f59e0b' : '#6b7280'
                  const typeIcon = action.type === 'habit' ? '✅' : action.type === 'todo' ? '📋' : action.type === 'counter' ? '🎯' : '🍅'
                  const typeHref = action.type === 'habit' ? '/habits' : action.type === 'todo' ? '/todos' : action.type === 'counter' ? '/counters' : '/now'
                  return (
                    <Link key={i} href={typeHref}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-opacity active:opacity-70"
                      style={{ background: 'var(--surface-2)', border: `1px solid ${uColor}20` }}>
                      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                        <span className="text-base">{typeIcon}</span>
                        <span className="text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center"
                          style={{ background: uColor, color: 'white' }}>{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">{action.title}</p>
                        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>{action.reason}</p>
                      </div>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                        style={{ background: `${uColor}15`, color: uColor }}>{action.urgency}</span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted py-1">Tap ↻ to get AI-powered recommendations based on your habits, todos &amp; counters.</p>
            )}
          </section>

          {/* 8. COUNTER GOALS */}
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

          {/* 9. DUE TODAY */}
          {dueTodayTodos.length > 0 && (
            <section className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-1.5">📅 Due Today</h3>
                <Link href="/todos" className="text-xs" style={{ color: '#14b8a6' }}>All →</Link>
              </div>
              <div className="space-y-2">
                {dueTodayTodos.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: 'var(--surface-2)', border: '1px solid rgba(245,158,11,0.25)' }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: t.priority === 1 ? '#ef4444' : t.priority === 2 ? '#f59e0b' : '#6b7280' }} />
                    <span className="text-sm flex-1 leading-snug">{t.title}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>P{t.priority}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 10. MEDICATIONS */}
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
                        style={taken ? { background: '#22c55e', color: 'white' } : { border: '2px solid var(--border)', color: 'transparent' }}>
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

          {/* 11. FOCUS SESSIONS TODAY */}
          {focusSessions.length > 0 && (
            <section className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  🍅 Focus Sessions
                  {focusStreak > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🔥 {focusStreak}d</span>}
                </h3>
                <Link href="/now" className="text-xs" style={{ color: '#14b8a6' }}>+ Session →</Link>
              </div>
              <div className="space-y-2">
                {focusSessions.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                    <span className="text-base">🍅</span>
                    <p className="text-sm flex-1 truncate">{s.taskText}</p>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>{s.durationMins}m</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 12. CORRELATION ENGINE */}
          <section className="card" style={{ border: '1px solid rgba(20,184,166,0.15)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-1.5">🔗 Correlation Engine</h3>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>What CAUSES your patterns</p>
              </div>
              <button onClick={loadCorrelations} disabled={correlationsLoading}
                className="text-xs px-2.5 py-1 rounded-lg disabled:opacity-40"
                style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                {correlationsLoading ? '⏳' : correlationsLoaded ? '↻ Refresh' : '🔍 Analyse'}
              </button>
            </div>
            {correlationsLoading ? (
              <div className="flex items-center gap-1.5 py-1">
                {[0, 0.15, 0.3].map((d, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#14b8a6', animationDelay: `${d}s` }} />
                ))}
                <span className="text-xs text-muted ml-1">Cross-referencing your trackers…</span>
              </div>
            ) : correlations.length > 0 ? (
              <div className="space-y-3">
                {correlations.map((c, i) => {
                  const sColor = c.strength === 'strong' ? '#ef4444' : c.strength === 'moderate' ? '#f59e0b' : '#6b7280'
                  return (
                    <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.75rem', border: `1px solid ${sColor}20` }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <p style={{ fontSize: '0.82rem', fontWeight: 700, flex: 1 }}>{c.title}</p>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: sColor, background: `${sColor}15`, borderRadius: 99, padding: '1px 7px', flexShrink: 0 }}>{c.strength}</span>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--foreground)', marginBottom: '0.3rem', lineHeight: 1.5 }}>{c.finding}</p>
                      <p style={{ fontSize: '0.73rem', color: '#14b8a6', fontWeight: 500 }}>→ {c.action}</p>
                    </div>
                  )
                })}
              </div>
            ) : !correlationsLoaded ? (
              <p className="text-xs text-muted">Tap Analyse — AI cross-references your sleep, habits, cravings &amp; food to find hidden patterns.</p>
            ) : (
              <p className="text-xs text-muted">Not enough data yet — log more days to unlock correlations.</p>
            )}
          </section>

          {/* 13. FOOD LOG */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">🥗 Food Today</h3>
              <Link href="/trackers/food" className="text-xs px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>+ Log Meal</Link>
            </div>
            {foodStats.calories > 0 ? (
              <div className="flex gap-3">
                <div className="flex-1 text-center px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{foodStats.calories}</p>
                  <p className="text-[10px] text-muted">calories</p>
                </div>
                <div className="flex-1 text-center px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-lg font-bold" style={{ color: '#14b8a6' }}>{foodStats.protein}g</p>
                  <p className="text-[10px] text-muted">protein</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">No meals logged yet today.</p>
            )}
          </section>

        </div>{/* end RIGHT column */}

      </div>{/* end desktop-two-col */}

      {/* ── Full-width footer: mini save ── */}
      <div className="flex items-center justify-end flex-wrap gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-full font-semibold disabled:opacity-50"
          style={{ background: saved ? 'rgba(34,197,94,0.15)' : 'rgba(20,184,166,0.12)', color: saved ? '#22c55e' : '#14b8a6', border: `1px solid ${saved ? 'rgba(34,197,94,0.3)' : 'rgba(20,184,166,0.3)'}` }}>
          {saving ? '⏳ Saving…' : saved ? '✓ +20 XP logged' : '⚡ Log check-in (+20 XP)'}
        </button>
      </div>

    </div>
  )
}
