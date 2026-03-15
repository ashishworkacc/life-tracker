'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Link from 'next/link'

interface Session {
  date: string
  taskText: string
  durationMins: number
  timestamp?: string
}

export default function FocusPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [sessions, setSessions] = useState<Session[]>([])
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    if (!user) return
    const docs = await queryDocuments('pomodoro_sessions', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(100),
    ])

    const mapped = docs.map(d => ({
      date: d.date,
      taskText: d.taskText ?? '',
      durationMins: d.durationMins ?? 25,
      timestamp: typeof d.timestamp === 'string' ? d.timestamp
        : (d.timestamp?.toDate?.()?.toISOString?.() ?? null),
    }))
    setSessions(mapped)

    // Streak: consecutive days with >= 1 session
    const datesWithSessions = new Set(docs.map(d => d.date as string))
    let s = 0
    for (let i = 0; i <= 60; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const ds = d.toISOString().split('T')[0]
      if (datesWithSessions.has(ds)) s++
      else if (i > 0) break
    }
    setStreak(s)
    setLoading(false)
  }

  // Heatmap: 56 days
  const heatmap: Record<string, number> = {}
  for (const s of sessions) heatmap[s.date] = (heatmap[s.date] ?? 0) + 1

  const todaySessions = sessions.filter(s => s.date === today)
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))

  // Weekly bar chart: last 14 days
  const barData: { day: string; sessions: number; mins: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = d.toISOString().split('T')[0]
    const daySessions = sessions.filter(s => s.date === ds)
    barData.push({
      day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      sessions: daySessions.length,
      mins: daySessions.reduce((s, d) => s + d.durationMins, 0),
    })
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Streak */}
      <div className="card text-center" style={{ border: '1px solid rgba(20,184,166,0.3)' }}>
        <p className="text-5xl mb-1">🔥</p>
        <p className="text-4xl font-bold" style={{ color: '#14b8a6' }}>{streak}</p>
        <p className="text-sm text-muted">day focus streak</p>
      </div>

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold">{todaySessions.length}</p>
          <p className="text-xs text-muted">Today</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold">{sessions.length}</p>
          <p className="text-xs text-muted">Total</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold">
            {Math.round(sessions.reduce((s, d) => s + d.durationMins, 0) / 60)}h
          </p>
          <p className="text-xs text-muted">Focus time</p>
        </div>
      </div>

      {/* Weekly bar chart */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">📊 Last 14 Days</h3>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={barData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 9 }} />
            <YAxis hide />
            <Tooltip
              formatter={(val: any) => [`${val} session${val !== 1 ? 's' : ''}`, 'Sessions']}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
            />
            <Bar dataKey="sessions" fill="#14b8a6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted text-center mt-1">
          {barData.reduce((s, d) => s + d.sessions, 0)} sessions in 2 weeks ·{' '}
          {Math.round(barData.reduce((s, d) => s + d.mins, 0) / 60 * 10) / 10}h focused
        </p>
      </div>

      {/* Today's sessions timeline */}
      {todaySessions.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Today&apos;s Sessions</h3>
          <div className="space-y-2">
            {todaySessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl"
                style={{ background: 'var(--surface-2)' }}>
                <span className="text-lg">🍅</span>
                <div className="flex-1">
                  <p className="text-sm">{s.taskText || 'Focus session'}</p>
                  {s.timestamp && (
                    <p className="text-xs text-muted">
                      {new Date(s.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  )}
                </div>
                <span className="text-xs font-medium px-2 py-1 rounded-full"
                  style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                  {s.durationMins}m
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 56-day heatmap */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Focus Calendar (56 days)</h3>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 56 }).map((_, i) => {
            const d = new Date()
            d.setDate(d.getDate() - (55 - i))
            const ds = d.toISOString().split('T')[0]
            const count = heatmap[ds] ?? 0
            const isToday = ds === today
            return (
              <div key={i} className="w-4 h-4 rounded-sm"
                style={{
                  background: count > 0 ? '#14b8a6' : 'var(--surface-2)',
                  opacity: count > 0 ? Math.min(0.4 + count * 0.2, 1) : 0.5,
                  border: isToday ? '1.5px solid #14b8a6' : 'none',
                }}
                title={`${ds}: ${count} session${count !== 1 ? 's' : ''}`}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 justify-end">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--surface-2)' }} />
            <span className="text-[10px] text-muted">None</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#14b8a6' }} />
            <span className="text-[10px] text-muted">Sessions</span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <Link href="/now"
        className="w-full py-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
        style={{ background: '#14b8a6', color: 'white' }}>
        🍅 Start Pomodoro Session
      </Link>
    </div>
  )
}
