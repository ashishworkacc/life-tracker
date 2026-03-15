'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, where, orderBy } from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Badge {
  id: string
  badgeType: string
  earnedAt: string
}

interface XPEvent {
  id: string
  date: string
  eventType: string
  xpEarned: number
  description: string
}

const BADGE_META: Record<string, { icon: string; label: string; desc: string }> = {
  first_habit: { icon: '✅', label: 'First Habit', desc: 'Completed your first habit' },
  streak_7: { icon: '🔥', label: '7-Day Streak', desc: 'Maintained a habit for 7 consecutive days' },
  streak_30: { icon: '💎', label: '30-Day Streak', desc: 'Maintained a habit for 30 consecutive days' },
  book_finish: { icon: '📗', label: 'Book Finisher', desc: 'Completed reading a book' },
  week_champion: { icon: '🏆', label: 'Week Champion', desc: 'Completed all habits for a full week' },
  burnout_warrior: { icon: '🌙', label: 'Burnout Warrior', desc: 'Used Burnout Mode and kept going' },
  counter_25: { icon: '⭐', label: '25% Counter', desc: 'Reached 25% on a custom counter' },
  counter_50: { icon: '🌟', label: '50% Counter', desc: 'Reached 50% on a custom counter' },
  counter_100: { icon: '🎉', label: 'Counter Complete!', desc: 'Hit 100% on a custom counter' },
  milestone_hit: { icon: '🎯', label: 'Milestone Hit', desc: 'Completed a goal milestone' },
  gym_first: { icon: '🏋️', label: 'First Gym', desc: 'Logged your first gym session' },
}

function xpForLevel(level: number) {
  return Math.round(200 * Math.pow(1.5, level - 1))
}

export default function GamificationPage() {
  const { user } = useAuth()

  const [totalXP, setTotalXP] = useState(0)
  const [level, setLevel] = useState(1)
  const [badges, setBadges] = useState<Badge[]>([])
  const [recentEvents, setRecentEvents] = useState<XPEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadGamification()
  }, [user])

  async function loadGamification() {
    if (!user) return

    const [xpDocs, badgeDocs, eventDocs] = await Promise.all([
      queryDocuments('user_xp', [where('userId', '==', user.uid)]),
      queryDocuments('badges', [
        where('userId', '==', user.uid),
        orderBy('earnedAt', 'desc'),
      ]),
      queryDocuments('xp_events', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
      ]),
    ])

    if (xpDocs.length > 0) {
      setTotalXP(xpDocs[0].totalXP ?? 0)
      setLevel(xpDocs[0].level ?? 1)
    } else {
      // Calculate from events
      const total = eventDocs.reduce((s, e) => s + (e.xpEarned ?? 0), 0)
      setTotalXP(total)
      // Determine level
      let lvl = 1
      while (xpForLevel(lvl + 1) <= total) lvl++
      setLevel(lvl)
    }

    setBadges(badgeDocs.map(b => ({
      id: b.id,
      badgeType: b.badgeType,
      earnedAt: b.earnedAt,
    })))

    setRecentEvents(eventDocs.slice(0, 20).map(e => ({
      id: e.id,
      date: e.date,
      eventType: e.eventType,
      xpEarned: e.xpEarned ?? 0,
      description: e.description ?? '',
    })))

    setLoading(false)
  }

  const nextLevelXp = xpForLevel(level + 1)
  const prevLevelXp = level > 1 ? xpForLevel(level) : 0
  const xpInCurrentLevel = totalXP - prevLevelXp
  const xpNeededForLevel = nextLevelXp - prevLevelXp
  const levelProgress = Math.min((xpInCurrentLevel / xpNeededForLevel) * 100, 100)

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Level card */}
      <div className="card text-center" style={{ border: '1px solid rgba(20,184,166,0.3)', background: 'linear-gradient(135deg, rgba(20,184,166,0.05), rgba(99,102,241,0.05))' }}>
        <div className="text-5xl mb-2">⚡</div>
        <p className="text-xs text-muted uppercase font-semibold tracking-wider">Level</p>
        <p className="text-5xl font-bold" style={{ color: '#14b8a6' }}>{level}</p>
        <p className="text-sm text-muted mt-1">{totalXP.toLocaleString()} total XP</p>
        <div className="mt-3 w-full rounded-full h-3 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${levelProgress}%`, background: 'linear-gradient(90deg, #14b8a6, #818cf8)' }} />
        </div>
        <p className="text-xs text-muted mt-1">
          {xpInCurrentLevel.toLocaleString()} / {xpNeededForLevel.toLocaleString()} XP to Level {level + 1}
        </p>
      </div>

      {/* Weekly XP bar chart */}
      {(() => {
        const last7: { day: string; xp: number; date: string }[] = []
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const ds = d.toISOString().split('T')[0]
          const dayXp = recentEvents.filter(e => e.date === ds).reduce((s, e) => s + e.xpEarned, 0)
          last7.push({ day: d.toLocaleDateString('en-IN', { weekday: 'short' }), xp: dayXp, date: ds })
        }
        const today = new Date().toISOString().split('T')[0]
        return (
          <div className="card">
            <h3 className="font-semibold text-sm mb-3">📈 XP This Week</h3>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={last7} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(val: any) => [`${val} XP`, '']}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="xp" radius={[3, 3, 0, 0]}>
                  {last7.map((entry, i) => (
                    <Cell key={i} fill={entry.date === today ? '#14b8a6' : '#818cf8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted text-center mt-1">
              {last7.reduce((s, d) => s + d.xp, 0)} XP this week
            </p>
          </div>
        )
      })()}

      {/* XP Breakdown */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">How to Earn XP</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { action: 'Complete habit', xp: '+10 XP', color: '#22c55e' },
            { action: 'Complete todo', xp: '+10 XP', color: '#22c55e' },
            { action: 'Daily save', xp: '+20 XP', color: '#14b8a6' },
            { action: 'Counter +1', xp: '+15 XP', color: '#818cf8' },
            { action: '7-day streak', xp: '+50 XP', color: '#f59e0b' },
            { action: 'Milestone hit', xp: '+100 XP', color: '#ef4444' },
            { action: 'Counter 25%', xp: '+100 XP', color: '#a855f7' },
            { action: 'Counter 100%', xp: '+500 XP', color: '#ec4899' },
          ].map(item => (
            <div key={item.action} className="flex items-center justify-between px-3 py-2 rounded-xl"
              style={{ background: 'var(--surface-2)' }}>
              <span className="text-xs">{item.action}</span>
              <span className="text-xs font-bold" style={{ color: item.color }}>{item.xp}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Badges ({badges.length})</h3>
        {badges.length === 0 ? (
          <p className="text-sm text-muted text-center py-4">No badges yet — keep going!</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {badges.map(b => {
              const meta = BADGE_META[b.badgeType] ?? { icon: '🏅', label: b.badgeType, desc: '' }
              return (
                <div key={b.id} className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl"
                  style={{ background: 'var(--surface-2)' }}>
                  <span className="text-3xl">{meta.icon}</span>
                  <span className="text-[11px] font-medium text-center">{meta.label}</span>
                  <span className="text-[10px] text-muted">
                    {new Date(b.earnedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent XP events */}
      {recentEvents.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Recent XP</h3>
          <div className="space-y-2">
            {recentEvents.map(e => (
              <div key={e.id} className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs">{e.description}</p>
                  <p className="text-[10px] text-muted">{e.date}</p>
                </div>
                <span className="text-sm font-bold" style={{ color: '#14b8a6' }}>+{e.xpEarned}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
