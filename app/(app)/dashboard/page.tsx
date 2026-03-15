'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetricCard {
  label: string
  value: string | number
  unit?: string
  icon: string
  color?: string
  sub?: string
}

interface HabitDot {
  date: string
  done: number
  total: number
}

interface SleepBar {
  day: string
  hours: number
}

interface CounterSummary {
  id: string
  name: string
  emoji: string
  currentCount: number
  targetCount: number
  color: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [metrics, setMetrics] = useState<MetricCard[]>([])
  const [habitDots, setHabitDots] = useState<HabitDot[]>([])
  const [sleepData, setSleepData] = useState<SleepBar[]>([])
  const [counters, setCounters] = useState<CounterSummary[]>([])
  const [xpTotal, setXpTotal] = useState(0)
  const [xpLevel, setXpLevel] = useState(1)
  const [todayXp, setTodayXp] = useState(0)
  const [todoStats, setTodoStats] = useState({ personal: 0, work: 0 })
  const [focusToday, setFocusToday] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadDashboard()
  }, [user])

  async function loadDashboard() {
    if (!user) return

    // Get last 14 days of daily summaries
    const summaries = await queryDocuments('daily_summaries', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(14),
    ])

    const todaySummary = summaries.find(s => s.date === today)

    // Focus sessions today (load before building metrics)
    const focusDocs = await queryDocuments('pomodoro_sessions', [
      where('userId', '==', user.uid),
      where('date', '==', today),
    ])
    setFocusToday(focusDocs.length)

    // Build metric cards
    const cards: MetricCard[] = [
      {
        label: 'Sleep',
        icon: '😴',
        value: todaySummary?.hoursSlept ?? (summaries[0]?.hoursSlept ?? '—'),
        unit: 'hrs',
        color: '#818cf8',
        sub: todaySummary?.hoursSlept ? (todaySummary.hoursSlept >= 7 ? 'Good' : 'Low') : 'Not logged',
      },
      {
        label: 'Weight',
        icon: '⚖️',
        value: todaySummary?.weight ?? (summaries.find(s => s.weight)?.weight ?? '—'),
        unit: 'kg',
        color: '#f59e0b',
        sub: 'Today',
      },
      {
        label: 'Habits',
        icon: '✅',
        value: todaySummary ? `${todaySummary.habitsDone}/${todaySummary.habitsTotal}` : '—',
        color: '#22c55e',
        sub: todaySummary?.habitsDone
          ? `${Math.round((todaySummary.habitsDone / Math.max(todaySummary.habitsTotal, 1)) * 100)}% done`
          : 'Not started',
      },
      {
        label: 'Screen',
        icon: '📱',
        value: todaySummary?.phoneMinutes ?? '—',
        unit: 'min',
        color: '#ef4444',
        sub: todaySummary?.phoneMinutes ? (todaySummary.phoneMinutes > 120 ? 'High' : 'OK') : 'Not logged',
      },
      {
        label: 'Focus',
        icon: '🍅',
        value: focusDocs.length,
        unit: focusDocs.length === 1 ? 'session' : 'sessions',
        color: '#a855f7',
        sub: focusDocs.length > 0 ? `${focusDocs.length * 25}min focused` : 'None yet',
      },
    ]
    setMetrics(cards)

    // Build 7-day habit dots
    const last7 = summaries.slice(0, 7).reverse()
    setHabitDots(last7.map(s => ({
      date: s.date,
      done: s.habitsDone ?? 0,
      total: s.habitsTotal ?? 0,
    })))

    // Build 14-day sleep chart
    const sleepBars: SleepBar[] = summaries.slice(0, 14).reverse().map(s => ({
      day: new Date(s.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' }),
      hours: s.hoursSlept ?? 0,
    }))
    setSleepData(sleepBars)

    // Load top 3 custom counters
    const counterDocs = await queryDocuments('custom_counters', [
      where('userId', '==', user.uid),
    ])
    setCounters(
      counterDocs
        .sort((a, b) => (b.currentCount / Math.max(b.targetCount, 1)) - (a.currentCount / Math.max(a.targetCount, 1)))
        .slice(0, 3)
        .map(c => ({
          id: c.id,
          name: c.name,
          emoji: c.emoji ?? '🎯',
          currentCount: c.currentCount ?? 0,
          targetCount: c.targetCount ?? 100,
          color: c.color ?? '#14b8a6',
        }))
    )

    // Load XP
    const xpDocs = await queryDocuments('user_xp', [where('userId', '==', user.uid)])
    if (xpDocs.length > 0) {
      setXpTotal(xpDocs[0].totalXP ?? 0)
      setXpLevel(xpDocs[0].level ?? 1)
    }

    // Today's XP events
    const todayXpEvents = await queryDocuments('xp_events', [
      where('userId', '==', user.uid),
      where('date', '==', today),
    ])
    setTodayXp(todayXpEvents.reduce((sum, e) => sum + (e.xpEarned ?? 0), 0))

    // Todo stats
    const pendingTodos = await queryDocuments('todos', [
      where('userId', '==', user.uid),
      where('completed', '==', false),
    ])
    setTodoStats({
      personal: pendingTodos.filter(t => t.category === 'personal').length,
      work: pendingTodos.filter(t => t.category === 'work').length,
    })

    setLoading(false)
  }

  // XP to next level
  function xpForLevel(level: number) {
    return Math.round(200 * Math.pow(1.5, level - 1))
  }
  const nextLevelXp = xpForLevel(xpLevel)
  const prevLevelXp = xpLevel > 1 ? xpForLevel(xpLevel - 1) : 0
  const xpProgress = Math.min(((xpTotal - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100, 100)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">📊</div>
          <p className="text-sm text-muted">Loading your stats...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* XP Level Bar */}
      <div className="card" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <span className="font-semibold text-sm">Level {xpLevel}</span>
            <span className="text-xs text-muted">— {xpTotal.toLocaleString()} XP total</span>
          </div>
          {todayXp > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>
              +{todayXp} today
            </span>
          )}
        </div>
        <div className="w-full rounded-full h-2.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${xpProgress}%`, background: 'linear-gradient(90deg, #14b8a6, #6366f1)' }}
          />
        </div>
        <p className="text-xs text-muted mt-1">
          {xpTotal - prevLevelXp} / {nextLevelXp - prevLevelXp} XP to Level {xpLevel + 1}
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map((m, i) => (
          <div key={i} className="card-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{m.icon}</span>
              <span className="text-xs text-muted">{m.label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" style={{ color: m.color }}>{m.value}</span>
              {m.unit && <span className="text-xs text-muted">{m.unit}</span>}
            </div>
            {m.sub && <p className="text-xs text-muted mt-0.5">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* 7-Day Habit Dots */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <span>✅</span> Last 7 Days
        </h3>
        <div className="flex justify-between gap-1">
          {Array.from({ length: 7 }).map((_, i) => {
            const date = new Date()
            date.setDate(date.getDate() - (6 - i))
            const dateStr = date.toISOString().split('T')[0]
            const dot = habitDots.find(d => d.date === dateStr)
            const pct = dot?.total ? dot.done / dot.total : 0
            const day = date.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)
            const isToday = dateStr === today

            let bg = 'var(--surface-2)'
            if (pct >= 0.9) bg = '#22c55e'
            else if (pct >= 0.6) bg = '#86efac'
            else if (pct >= 0.3) bg = '#fcd34d'
            else if (dot) bg = '#fca5a5'

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-lg"
                  style={{
                    height: '36px',
                    background: bg,
                    border: isToday ? '2px solid #14b8a6' : '1px solid var(--border)',
                    opacity: dot ? 1 : 0.4,
                  }}
                />
                <span className="text-[10px] text-muted">{day}</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 justify-end">
          {[['#22c55e', '90%+'], ['#86efac', '60%+'], ['#fcd34d', '30%+'], ['#fca5a5', '<30%']].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              <span className="text-[10px] text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 14-Day Sleep Chart */}
      {sleepData.some(d => d.hours > 0) && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <span>😴</span> Sleep (14 days)
          </h3>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={sleepData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any) => [`${val}h`, 'Sleep']}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {sleepData.map((d, i) => (
                  <Cell key={i} fill={d.hours >= 7 ? '#818cf8' : d.hours >= 6 ? '#a5b4fc' : '#fca5a5'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top Counters */}
      {counters.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <span>🎯</span> Custom Counters
            </h3>
            <a href="/counters" className="text-xs" style={{ color: '#14b8a6' }}>See all →</a>
          </div>
          <div className="space-y-3">
            {counters.map(c => {
              const pct = Math.min((c.currentCount / c.targetCount) * 100, 100)
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{c.emoji} {c.name}</span>
                    <span className="text-xs font-bold" style={{ color: c.color }}>
                      {c.currentCount} / {c.targetCount}
                    </span>
                  </div>
                  <div className="w-full rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: c.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Todo Count */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span>📋</span> Open Todos
          </h3>
          <a href="/todos" className="text-xs" style={{ color: '#14b8a6' }}>Manage →</a>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <a href="/todos?tab=personal" className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span className="text-xl">👤</span>
            <div>
              <p className="text-xs text-muted">Personal</p>
              <p className="text-lg font-bold">{todoStats.personal}</p>
            </div>
          </a>
          <a href="/todos?tab=work" className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span className="text-xl">💼</span>
            <div>
              <p className="text-xs text-muted">Work</p>
              <p className="text-lg font-bold">{todoStats.work}</p>
            </div>
          </a>
        </div>
      </div>

      {/* Quick nav to key features */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { href: '/habits', icon: '✅', label: 'Habits' },
          { href: '/trackers', icon: '📊', label: 'Trackers' },
          { href: '/goals', icon: '🎯', label: 'Goals' },
          { href: '/ai-insights', icon: '🤖', label: 'AI Insights' },
          { href: '/journal', icon: '📓', label: 'Journal' },
          { href: '/gamification', icon: '🏆', label: 'Badges' },
        ].map(item => (
          <a key={item.href} href={item.href}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-center transition-colors"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span className="text-xl">{item.icon}</span>
            <span className="text-[11px] text-muted">{item.label}</span>
          </a>
        ))}
      </div>

    </div>
  )
}
