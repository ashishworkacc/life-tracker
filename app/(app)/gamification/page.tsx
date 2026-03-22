'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  queryDocuments, updateDocument, addDocument,
  where, orderBy, todayDate,
} from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface XPEvent {
  id: string; date: string; eventType: string; xpEarned: number; description: string
}
interface Badge {
  id: string; badgeType: string; earnedAt: string
}
interface PlayerStats {
  id?: string
  hp: number; maxHp: number; fatigue: number
  str: number; vit: number; agi: number; int: number; per: number
  isRestDay: boolean; lastRestDay: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────
const BADGE_META: Record<string, { icon: string; label: string }> = {
  first_habit:     { icon: '✅', label: 'First Habit' },
  streak_7:        { icon: '🔥', label: '7-Day Streak' },
  streak_30:       { icon: '💎', label: '30-Day Streak' },
  book_finish:     { icon: '📗', label: 'Book Finisher' },
  week_champion:   { icon: '🏆', label: 'Week Champion' },
  burnout_warrior: { icon: '🌙', label: 'Burnout Warrior' },
  counter_25:      { icon: '⭐', label: '25% Counter' },
  counter_50:      { icon: '🌟', label: '50% Counter' },
  counter_100:     { icon: '🎉', label: 'Counter Complete' },
  milestone_hit:   { icon: '🎯', label: 'Milestone Hit' },
  gym_first:       { icon: '🏋️', label: 'First Gym' },
}

const ATTRS = [
  { key: 'str' as const, label: 'Strength',     icon: '💪', color: '#ef4444',
    desc: 'Gym, weight training, strength' },
  { key: 'vit' as const, label: 'Vitality',     icon: '❤️', color: '#10b981',
    desc: 'Sleep, nutrition, supplements' },
  { key: 'agi' as const, label: 'Agility',      icon: '⚡', color: '#f59e0b',
    desc: 'Running, cardio, sports' },
  { key: 'int' as const, label: 'Intelligence', icon: '🧠', color: '#6366f1',
    desc: 'Reading, study, deep work' },
  { key: 'per' as const, label: 'Perception',   icon: '👁️', color: '#8b5cf6',
    desc: 'Meditation, reflection, mindfulness' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function xpForLevel(lvl: number) { return Math.round(200 * Math.pow(1.5, lvl - 1)) }
function calcLevel(xp: number) {
  let lvl = 1, acc = 0
  while (acc + xpForLevel(lvl) <= xp) { acc += xpForLevel(lvl); lvl++ }
  return lvl
}
function xpInLevel(xp: number) {
  let acc = 0, lvl = 1
  while (acc + xpForLevel(lvl) <= xp) { acc += xpForLevel(lvl); lvl++ }
  return xp - acc
}
function attrLevel(xp: number) { return Math.min(50, Math.floor(xp / 200) + 1) }

function inferAttrs(text: string): (typeof ATTRS[number]['key'])[] {
  const n = text.toLowerCase()
  const out: (typeof ATTRS[number]['key'])[] = []
  if (/workout|gym|lift|strength|push.?up|pull.?up|squat|bench|deadlift/.test(n)) out.push('str')
  if (/run|jog|sprint|cycle|swim|sport|badminton|walk|hike|cardio/.test(n)) out.push('agi')
  if (/yoga|stretch|pilates|meditat|breath|mindful/.test(n)) out.push('per')
  if (/read|book|study|learn|course|write|code|research|focus|journal|reflect/.test(n)) out.push('int')
  if (/sleep|rest|vitamin|supplement|water|nutrition|meal|protein|fiber/.test(n)) out.push('vit')
  return out.length > 0 ? [...new Set(out)] : ['vit']
}

function playerClass(stats: PlayerStats) {
  const pairs: [typeof ATTRS[number]['key'], number][] = [
    ['str', stats.str], ['vit', stats.vit], ['agi', stats.agi], ['int', stats.int], ['per', stats.per],
  ]
  const top = pairs.reduce((a, b) => b[1] > a[1] ? b : a)
  return { str: 'Warrior', vit: 'Guardian', agi: 'Scout', int: 'Scholar', per: 'Sage' }[top[0]] ?? 'Adventurer'
}

const DEFAULT_STATS: Omit<PlayerStats, 'id'> = {
  hp: 100, maxHp: 100, fatigue: 0,
  str: 0, vit: 0, agi: 0, int: 0, per: 0,
  isRestDay: false, lastRestDay: null,
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function GamificationPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [totalXP, setTotalXP]   = useState(0)
  const [level, setLevel]       = useState(1)
  const [badges, setBadges]     = useState<Badge[]>([])
  const [events, setEvents]     = useState<XPEvent[]>([])
  const [stats, setStats]       = useState<PlayerStats>({ ...DEFAULT_STATS })
  const [statsId, setStatsId]   = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'character' | 'history' | 'guide'>('character')
  const [toggling, setToggling] = useState(false)
  // Coin system: 1 coin per 5 XP. Spendable on vices/rewards.
  const [rewards, setRewards]   = useState<{id: string; title: string; cost: number; redeemed: boolean}[]>([])
  const [spentCoins, setSpentCoins] = useState(0)
  const [showAddReward, setShowAddReward] = useState(false)
  const [newRewardTitle, setNewRewardTitle] = useState('')
  const [newRewardCost, setNewRewardCost] = useState('50')

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    if (!user) return
    const [xpDocs, badgeDocs, eventDocs, statsDocs, habitLogDocs, habitDocs, rewardDocs] = await Promise.all([
      queryDocuments('user_xp', [where('userId', '==', user.uid)]),
      queryDocuments('badges', [where('userId', '==', user.uid), orderBy('earnedAt', 'desc')]),
      queryDocuments('xp_events', [where('userId', '==', user.uid), orderBy('date', 'desc')]),
      queryDocuments('player_stats', [where('userId', '==', user.uid)]),
      queryDocuments('daily_habit_logs', [where('userId', '==', user.uid), where('date', '==', today)]),
      queryDocuments('habits', [where('userId', '==', user.uid), where('isActive', '==', true)]),
      queryDocuments('player_rewards', [where('userId', '==', user.uid)]),
    ])
    const loadedRewards = rewardDocs.map((r: any) => ({ id: r.id, title: r.title, cost: r.cost ?? 50, redeemed: r.redeemed ?? false }))
    setRewards(loadedRewards)
    setSpentCoins(loadedRewards.filter((r: any) => r.redeemed).reduce((s: number, r: any) => s + r.cost, 0))

    const computed = eventDocs.reduce((s, e) => s + (e.xpEarned ?? 0), 0)
    setTotalXP(computed)
    setLevel(calcLevel(computed))
    if (xpDocs[0] && Math.abs((xpDocs[0].xpTotal ?? 0) - computed) > 0) {
      try { await updateDocument('user_xp', xpDocs[0].id, { xpTotal: computed }) } catch {}
    }

    setBadges(badgeDocs.map(b => ({ id: b.id, badgeType: b.badgeType, earnedAt: b.earnedAt })))
    setEvents(eventDocs.slice(0, 40).map(e => ({
      id: e.id, date: e.date, eventType: e.eventType,
      xpEarned: e.xpEarned ?? 0, description: e.description ?? '',
    })))

    // Compute attr XP from all habit events
    const attrXp = { str: 0, vit: 0, agi: 0, int: 0, per: 0 }
    for (const e of eventDocs) {
      if (e.eventType === 'habit') {
        const attrs = inferAttrs(e.description ?? '')
        const share = Math.floor((e.xpEarned ?? 10) / attrs.length)
        for (const a of attrs) attrXp[a as keyof typeof attrXp] += share
      }
    }

    // HP: +2 per habit done today, -5 per missed (if not rest day)
    let ps: PlayerStats
    if (statsDocs.length > 0) {
      const d = statsDocs[0]
      ps = {
        id: d.id, hp: d.hp ?? 100, maxHp: d.maxHp ?? 100, fatigue: d.fatigue ?? 0,
        ...attrXp,
        isRestDay: today === d.lastRestDay ? (d.isRestDay ?? false) : false,
        lastRestDay: d.lastRestDay ?? null,
      }
      setStatsId(d.id)
    } else {
      const newDoc = await addDocument('player_stats', { userId: user.uid, ...DEFAULT_STATS })
      setStatsId(newDoc.id)
      ps = { ...DEFAULT_STATS, ...attrXp }
    }

    const doneCount = (habitLogDocs as any[]).filter((l: any) => l.done).length
    const totalHabits = habitDocs.length
    const missed = ps.isRestDay ? 0 : Math.max(0, totalHabits - doneCount)
    const newHp = Math.max(0, Math.min(ps.maxHp,
      ps.hp + doneCount * 2 - missed * 5 + (ps.isRestDay ? 10 : 0)
    ))

    setStats({ ...ps, hp: newHp, ...attrXp })
    setLoading(false)
  }

  async function toggleRestDay() {
    if (!statsId || !user || toggling) return
    setToggling(true)
    const newVal = !stats.isRestDay
    const newHp  = newVal ? Math.min(stats.maxHp, stats.hp + 10) : stats.hp
    await updateDocument('player_stats', statsId, {
      isRestDay: newVal, lastRestDay: newVal ? today : stats.lastRestDay, hp: newHp,
    })
    setStats(s => ({ ...s, isRestDay: newVal, lastRestDay: newVal ? today : s.lastRestDay, hp: newHp }))
    setToggling(false)
  }

  const lvlProgress = Math.min(100, (xpInLevel(totalXP) / xpForLevel(level)) * 100)
  const hpPct = Math.max(0, Math.min(100, (stats.hp / stats.maxHp) * 100))
  const cls   = playerClass(stats)
  const totalCoins  = Math.floor(totalXP / 5)
  const availCoins  = Math.max(0, totalCoins - spentCoins)

  async function addReward() {
    if (!user || !newRewardTitle.trim()) return
    const cost = parseInt(newRewardCost) || 50
    const doc = await addDocument('player_rewards', { userId: user.uid, title: newRewardTitle.trim(), cost, redeemed: false })
    setRewards(r => [...r, { id: doc.id, title: newRewardTitle.trim(), cost, redeemed: false }])
    setNewRewardTitle(''); setShowAddReward(false)
  }

  async function redeemReward(r: { id: string; title: string; cost: number; redeemed: boolean }) {
    if (r.redeemed || availCoins < r.cost) return
    await updateDocument('player_rewards', r.id, { redeemed: true })
    setRewards(prev => prev.map(x => x.id === r.id ? { ...x, redeemed: true } : x))
    setSpentCoins(s => s + r.cost)
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1rem 1rem 6rem' }}>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 10, padding: 3, marginBottom: '1rem', border: '1px solid var(--border)', gap: '0.25rem' }}>
        {([['character','⚔️ Character'],['history','📜 History'],['guide','📖 Guide']] as const).map(([t, lbl]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: '0.82rem', fontWeight: 600,
            background: tab === t ? '#14b8a6' : 'transparent',
            color: tab === t ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s',
          }}>{lbl}</button>
        ))}
      </div>

      {/* ─── CHARACTER ───────────────────────────────────────────────────── */}
      {tab === 'character' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

          {/* Hero card */}
          <div className="card" style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(20,184,166,0.08))', border: '1px solid rgba(99,102,241,0.25)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, borderRadius: '0 0 0 100%', background: 'rgba(99,102,241,0.06)' }} />

            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div style={{ width: 60, height: 60, borderRadius: 14, flexShrink: 0, background: 'linear-gradient(135deg,#6366f1,#14b8a6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}>⚔️</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.1rem' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 800 }}>Player</span>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.18)', color: '#6366f1', padding: '0.1rem 0.45rem', borderRadius: 99, fontWeight: 700 }}>{cls}</span>
                  {stats.isRestDay && <span style={{ fontSize: '0.68rem', background: 'rgba(20,184,166,0.15)', color: '#14b8a6', padding: '0.1rem 0.45rem', borderRadius: 99, fontWeight: 700 }}>🌙 Rest Day</span>}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Level {level} · {totalXP.toLocaleString()} XP</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: '2.2rem', fontWeight: 900, color: '#14b8a6', margin: 0, lineHeight: 1 }}>{level}</p>
                <p style={{ fontSize: '0.58rem', color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level</p>
              </div>
            </div>

            {/* HP */}
            <div style={{ marginBottom: '0.55rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.2rem' }}>
                <span style={{ color: '#ef4444', fontWeight: 700 }}>❤️ HP {stats.hp}/{stats.maxHp}</span>
                <span style={{ color: hpPct > 60 ? '#10b981' : hpPct > 30 ? '#f59e0b' : '#ef4444', fontWeight: 700, fontSize: '0.65rem' }}>
                  {hpPct > 60 ? 'Healthy' : hpPct > 30 ? 'Wounded' : '⚠️ Critical — complete your habits!'}
                </span>
              </div>
              <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${hpPct}%`, borderRadius: 99, transition: 'width 0.5s', background: hpPct > 60 ? '#10b981' : hpPct > 30 ? '#f59e0b' : '#ef4444' }} />
              </div>
            </div>

            {/* XP */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.2rem' }}>
                <span style={{ color: '#14b8a6', fontWeight: 700 }}>⚡ {xpInLevel(totalXP).toLocaleString()} / {xpForLevel(level).toLocaleString()} XP</span>
                <span style={{ color: 'var(--text-muted)' }}>→ Level {level + 1}</span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${lvlProgress}%`, borderRadius: 99, background: 'linear-gradient(90deg,#14b8a6,#6366f1)', transition: 'width 0.5s' }} />
              </div>
            </div>

            {/* Rest Day toggle */}
            <button onClick={toggleRestDay} disabled={toggling} style={{
              width: '100%', padding: '0.5rem', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: stats.isRestDay ? 'rgba(20,184,166,0.15)' : 'rgba(99,102,241,0.1)',
              color: stats.isRestDay ? '#14b8a6' : '#6366f1',
              fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.2s',
            }}>
              {stats.isRestDay
                ? '🌙 Rest Day Active — No penalties · HP recovering'
                : '🟢 Mark Today as Rest Day (pauses all penalties)'}
            </button>
          </div>

          {/* ── Coin Vault ────────────────────────────────────────────── */}
          <div className="card" style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.1rem', color: '#eab308' }}>🪙 Coin Vault</p>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: 0 }}>Earned: {totalCoins.toLocaleString()} · Spent: {spentCoins} · <strong style={{ color: '#eab308' }}>Available: {availCoins}</strong></p>
              </div>
              <button onClick={() => setShowAddReward(v => !v)} style={{
                background: '#eab308', color: '#000', border: 'none', borderRadius: 8,
                padding: '0.3rem 0.65rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
              }}>+ Reward</button>
            </div>

            {showAddReward && (
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <input value={newRewardTitle} onChange={e => setNewRewardTitle(e.target.value)}
                  placeholder="Reward name (e.g. Cheat meal, Movie night)"
                  style={{ flex: 1, minWidth: 160, padding: '0.45rem 0.65rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.78rem', outline: 'none' }} />
                <input type="number" value={newRewardCost} onChange={e => setNewRewardCost(e.target.value)}
                  placeholder="Cost"
                  style={{ width: 70, padding: '0.45rem 0.65rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.78rem', outline: 'none' }} />
                <button onClick={addReward} style={{ background: '#eab308', color: '#000', border: 'none', borderRadius: 8, padding: '0.45rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>Add</button>
              </div>
            )}

            {rewards.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem 0' }}>No rewards yet. Add something to work toward!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {rewards.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.45rem 0.65rem', background: 'var(--surface-2)', borderRadius: 10,
                    opacity: r.redeemed ? 0.5 : 1 }}>
                    <span style={{ flex: 1, fontSize: '0.8rem', textDecoration: r.redeemed ? 'line-through' : 'none' }}>{r.title}</span>
                    <span style={{ fontSize: '0.72rem', color: '#eab308', fontWeight: 700 }}>🪙{r.cost}</span>
                    {!r.redeemed ? (
                      <button onClick={() => redeemReward(r)} disabled={availCoins < r.cost} style={{
                        background: availCoins >= r.cost ? '#eab308' : 'var(--surface)',
                        color: availCoins >= r.cost ? '#000' : 'var(--text-muted)',
                        border: '1px solid var(--border)', borderRadius: 7,
                        padding: '0.2rem 0.55rem', fontSize: '0.68rem', fontWeight: 700,
                        cursor: availCoins >= r.cost ? 'pointer' : 'not-allowed',
                      }}>Redeem</button>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>✓ Used</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attributes */}
          <div className="card" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.85rem', color: '#6366f1' }}>⚔️ Attributes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {ATTRS.map(attr => {
                const xp  = stats[attr.key as keyof PlayerStats] as number
                const lvl = attrLevel(xp)
                const pct = Math.min(100, (xp % 200) / 200 * 100)
                return (
                  <div key={attr.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.95rem' }}>{attr.icon}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: attr.color }}>{attr.label}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{attr.desc}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{xp.toLocaleString()} XP</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: attr.color }}>Lv.{lvl}</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: attr.color, borderRadius: 99, opacity: 0.85, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.75rem', textAlign: 'center' }}>
              Attributes grow from habit completions. Dominant attribute = your class.
            </p>
          </div>

          {/* Penalty system */}
          <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem', color: '#ef4444' }}>⚠️ Continuity System</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {[
                { l: '✅ Habit done', v: '+2 HP', c: '#10b981' },
                { l: '❌ Habit missed', v: '-5 HP', c: '#ef4444', s: 'if not rest day' },
                { l: '🌙 Rest Day', v: '+10 HP', c: '#14b8a6', s: 'no penalties' },
                { l: '💀 HP < 30%', v: '⚠️ Critical', c: '#f59e0b' },
              ].map(x => (
                <div key={x.l} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.55rem 0.65rem' }}>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 0 0.1rem' }}>{x.l}</p>
                  <p style={{ fontSize: '0.85rem', fontWeight: 800, color: x.c, margin: 0 }}>{x.v}</p>
                  {x.s && <p style={{ fontSize: '0.58rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>{x.s}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Badges */}
          {badges.length > 0 && (
            <div className="card">
              <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem' }}>🏅 Badges ({badges.length})</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.4rem' }}>
                {badges.map(b => {
                  const meta = BADGE_META[b.badgeType] ?? { icon: '🏅', label: b.badgeType }
                  return (
                    <div key={b.id} style={{ textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, padding: '0.6rem 0.3rem' }}>
                      <div style={{ fontSize: '1.5rem', marginBottom: '0.2rem' }}>{meta.icon}</div>
                      <p style={{ fontSize: '0.6rem', fontWeight: 600, margin: 0, color: 'var(--text-muted)' }}>{meta.label}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── HISTORY ─────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {(() => {
            const last7 = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(); d.setDate(d.getDate() - (6 - i))
              const ds = d.toISOString().split('T')[0]
              return { day: d.toLocaleDateString('en-IN', { weekday: 'short' }), xp: events.filter(e => e.date === ds).reduce((s, e) => s + e.xpEarned, 0), isToday: ds === today }
            })
            return (
              <div className="card">
                <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem' }}>📈 XP This Week — {last7.reduce((s, d) => s + d.xp, 0).toLocaleString()} total</p>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={last7} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: any) => [`${v} XP`, '']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="xp" radius={[3, 3, 0, 0]}>
                      {last7.map((e, i) => <Cell key={i} fill={e.isToday ? '#14b8a6' : '#6366f1'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          })()}

          <div className="card">
            <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem' }}>Recent XP Events</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {events.map(e => {
                const attrs = e.eventType === 'habit' ? inferAttrs(e.description) : []
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '0.78rem', margin: '0 0 0.1rem' }}>{e.description}</p>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <p style={{ fontSize: '0.62rem', color: 'var(--text-muted)', margin: 0 }}>{e.date}</p>
                        {attrs.map(a => { const m = ATTRS.find(x => x.key === a); return m ? <span key={a} style={{ fontSize: '0.58rem', color: m.color, fontWeight: 700 }}>{m.icon}{m.label.slice(0,3).toUpperCase()}</span> : null })}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#14b8a6', flexShrink: 0 }}>+{e.xpEarned}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── GUIDE ───────────────────────────────────────────────────────── */}
      {tab === 'guide' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card">
            <p style={{ fontSize: '0.88rem', fontWeight: 800, margin: '0 0 0.85rem' }}>📖 The Solo Leveling System</p>
            {[
              { t: '⚔️ You are the Player', b: 'Every habit completed, task finished, book read — it all translates to real attributes. You are the character.' },
              { t: '❤️ HP = Your Life Force', b: 'Completing habits heals HP (+2). Missing habits costs HP (-5). Drop below 30% and you\'re in critical state. Mark rest days to recover.' },
              { t: '💪 Attributes grow from habits', b: 'Keywords in your habit names determine attributes. "Gym session" → STR. "Morning run" → AGI. "Read 20 pages" → INT. "Meditate" → PER.' },
              { t: '🏆 Your class emerges from behavior', b: 'Dominant attribute = your class. Warrior (STR), Scholar (INT), Scout (AGI), Guardian (VIT), Sage (PER).' },
              { t: '🌙 Rest Day = No Punishment', b: 'Mark a rest day to suspend continuity. No HP penalty. HP actively recovers +10. Not an excuse — a strategic tool.' },
            ].map(x => (
              <div key={x.t} style={{ padding: '0.65rem 0.75rem', background: 'var(--surface-2)', borderRadius: 10, marginBottom: '0.5rem' }}>
                <p style={{ fontWeight: 700, fontSize: '0.82rem', margin: '0 0 0.25rem' }}>{x.t}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{x.b}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem' }}>💡 How to Earn XP</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {[
                { a: '✅ Complete habit', v: '+10 XP + attr' }, { a: '📋 Complete todo', v: '+10 XP' },
                { a: '💾 Daily save', v: '+20 XP' }, { a: '📈 Counter progress', v: '+15 XP' },
                { a: '🔥 7-day streak', v: '+50 XP' }, { a: '🎯 Counter 100%', v: '+500 XP' },
              ].map(x => (
                <div key={x.a} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.65rem', background: 'var(--surface-2)', borderRadius: 8 }}>
                  <span style={{ fontSize: '0.72rem' }}>{x.a}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#14b8a6' }}>{x.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
