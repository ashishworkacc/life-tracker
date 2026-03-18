'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  addDocument, queryDocuments, updateDocument, deleteDocument,
  todayDate, where, orderBy
} from '@/lib/firebase/db'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, Cell,
} from 'recharts'

interface Counter {
  id: string
  name: string
  emoji: string
  unit: string
  targetCount: number
  initialCount: number
  deadline?: string
  currentCount: number
  color: string
  xpPerIncrement: number
  reward?: string
  createdAt?: string
}

interface CounterLog {
  id: string
  date: string
  countAdded: number
}

interface ChartPoint {
  date: string
  count?: number
  projected?: number
}

const PRESET_COLORS = ['#14b8a6', '#818cf8', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#ec4899']
const PRESET_EMOJIS = ['🏋️', '🎙️', '📵', '📚', '🏃', '🧘', '💊', '✍️', '🎯', '💻', '🎸', '🍎']

function buildChartData(counter: Counter, counterLogs: CounterLog[]): ChartPoint[] {
  const today = new Date().toISOString().split('T')[0]
  const dataByDate: Record<string, number> = {}
  for (const l of counterLogs) {
    dataByDate[l.date] = (dataByDate[l.date] ?? 0) + l.countAdded
  }
  // Start from first log or 7 days ago (whichever is more recent), always include today
  const firstLog = counterLogs.length > 0
    ? counterLogs.reduce((min, l) => l.date < min ? l.date : min, counterLogs[0].date)
    : today
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const startDate = firstLog < sevenDaysAgo.toISOString().split('T')[0] ? firstLog : sevenDaysAgo.toISOString().split('T')[0]
  const endDate = todayDate()
  const result: ChartPoint[] = []
  let cumulative = counter.initialCount ?? 0
  const cur = new Date(startDate)
  const end = new Date(today)
  while (cur <= end) {
    const ds = cur.toISOString().split('T')[0]
    cumulative = Math.max(counter.initialCount, cumulative + (dataByDate[ds] ?? 0))
    result.push({ date: ds, count: cumulative })
    cur.setDate(cur.getDate() + 1)
  }
  // Ensure we have at least 2 points for the chart to render
  if (result.length === 1) {
    const prev = new Date(startDate); prev.setDate(prev.getDate() - 1)
    result.unshift({ date: prev.toISOString().split('T')[0], count: counter.initialCount })
  }
  return result
}

function getProjection(counter: Counter, chartData: ChartPoint[]) {
  if (chartData.length < 2) return null
  const recent = chartData.slice(-14)
  const countGained = (recent[recent.length - 1].count ?? 0) - (recent[0].count ?? 0)
  const dailyRate = countGained / recent.length
  if (dailyRate <= 0) return null
  const remaining = counter.targetCount - counter.currentCount
  if (remaining <= 0) return null
  const daysToComplete = Math.ceil(remaining / dailyRate)
  const projectedPoints: ChartPoint[] = []
  let cum = counter.currentCount
  for (let i = 1; i <= Math.min(daysToComplete, 180); i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    cum = Math.min(cum + dailyRate, counter.targetCount)
    projectedPoints.push({ date: d.toISOString().split('T')[0], projected: Math.round(cum) })
  }
  const completionDate = new Date()
  completionDate.setDate(completionDate.getDate() + daysToComplete)
  return {
    completionDate: completionDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    daysToComplete,
    dailyRate: Math.round(dailyRate * 10) / 10,
    projectedPoints,
  }
}

export default function CountersPage() {
  const { user } = useAuth()
  const today = todayDate()
  const [counters, setCounters] = useState<Counter[]>([])
  const [logs, setLogs] = useState<Record<string, CounterLog[]>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingCounter, setEditingCounter] = useState<Counter | null>(null)
  const [historyCounterId, setHistoryCounterId] = useState<string | null>(null)
  const [histAddDate, setHistAddDate] = useState(todayDate())
  const [histAddCount, setHistAddCount] = useState('1')
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [editLogCount, setEditLogCount] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('🎯')
  const [newUnit, setNewUnit] = useState('')
  const [newInitial, setNewInitial] = useState('0')
  const [newTarget, setNewTarget] = useState('')
  const [newDeadline, setNewDeadline] = useState('')
  const [newColor, setNewColor] = useState('#14b8a6')
  const [newReward, setNewReward] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (user) loadData() }, [user])

  async function loadData() {
    if (!user) return
    const counterDocs = await queryDocuments('custom_counters', [where('userId', '==', user.uid)])
    const logDocs = await queryDocuments('counter_logs', [
      where('userId', '==', user.uid), orderBy('date', 'desc'),
    ])
    const grouped: Record<string, CounterLog[]> = {}
    for (const l of logDocs) {
      if (!grouped[l.counterId]) grouped[l.counterId] = []
      grouped[l.counterId].push({ id: l.id, date: l.date, countAdded: l.countAdded ?? 1 })
    }
    setLogs(grouped)

    // Sort counters by usage frequency (log entries in last 30 days, descending)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const sortedCounters = counterDocs
      .map(c => ({
        id: c.id, name: c.name, emoji: c.emoji ?? '🎯', unit: c.unit ?? '',
        targetCount: c.targetCount ?? 100, initialCount: c.initialCount ?? 0,
        deadline: c.deadline, currentCount: c.currentCount ?? 0,
        color: c.color ?? '#14b8a6', xpPerIncrement: c.xpPerIncrement ?? 15,
        reward: c.reward ?? '',
        createdAt: c.createdAt?.toDate?.()?.toISOString?.() ?? (typeof c.createdAt === 'string' ? c.createdAt : undefined),
        _freq: (grouped[c.id] ?? []).filter(l => l.date >= cutoffStr).length,
      }))
      .sort((a, b) => b._freq - a._freq)
      .map(({ _freq: _, ...c }) => c)

    setCounters(sortedCounters)
    setLoading(false)
  }

  async function createCounter() {
    if (!user || !newName.trim() || !newTarget) return
    setSaving(true)
    const initial = parseInt(newInitial) || 0
    await addDocument('custom_counters', {
      userId: user.uid, name: newName.trim(), emoji: newEmoji, unit: newUnit.trim(),
      targetCount: parseInt(newTarget), initialCount: initial, currentCount: initial,
      deadline: newDeadline || null, color: newColor, xpPerIncrement: 15,
      reward: newReward.trim() || null,
    })
    setNewName(''); setNewEmoji('🎯'); setNewUnit(''); setNewInitial('0')
    setNewTarget(''); setNewDeadline(''); setNewColor('#14b8a6'); setNewReward('')
    setShowAdd(false); setSaving(false)
    await loadData()
  }

  async function changeCount(counter: Counter, delta: number) {
    if (!user || actingId) return
    const newCount = Math.max(counter.initialCount, counter.currentCount + delta)
    if (newCount === counter.currentCount) return
    setActingId(counter.id)
    const milestoneXp: Record<number, number> = { 25: 100, 50: 200, 75: 300, 100: 500 }
    let bonusXp = 0
    if (delta > 0) {
      for (const [pctStr, xp] of Object.entries(milestoneXp)) {
        const threshold = Math.round((parseInt(pctStr) / 100) * counter.targetCount)
        if (counter.currentCount < threshold && newCount >= threshold) bonusXp = xp
      }
    }
    await Promise.all([
      updateDocument('custom_counters', counter.id, { currentCount: newCount }),
      addDocument('counter_logs', { userId: user.uid, counterId: counter.id, date: today, countAdded: delta, note: null }),
      ...(delta > 0 ? [addDocument('xp_events', {
        userId: user.uid, date: today, eventType: 'counter',
        xpEarned: counter.xpPerIncrement + bonusXp,
        description: `${counter.emoji} ${counter.name}: +${delta}${bonusXp ? ` (+${bonusXp} milestone XP!)` : ''}`,
      })] : []),
    ])
    setCounters(prev => prev.map(c => c.id === counter.id ? { ...c, currentCount: newCount } : c))
    setLogs(prev => ({ ...prev, [counter.id]: [...(prev[counter.id] ?? []), { id: `temp-${Date.now()}`, date: today, countAdded: delta }] }))
    setActingId(null)
  }

  async function deleteCounter(id: string) {
    await deleteDocument('custom_counters', id)
    setCounters(prev => prev.filter(c => c.id !== id))
    setMenuId(null)
  }

  async function recalcCounterTotal(counter: Counter, updatedLogs: CounterLog[]) {
    const total = counter.initialCount + updatedLogs.reduce((s, l) => s + l.countAdded, 0)
    await updateDocument('custom_counters', counter.id, { currentCount: total })
    setCounters(prev => prev.map(c => c.id === counter.id ? { ...c, currentCount: total } : c))
  }

  async function addHistoricalLog(counter: Counter) {
    if (!user || !histAddCount) return
    const delta = parseInt(histAddCount) || 1
    const newLog = { id: '', date: histAddDate, countAdded: delta }
    const docRef = await addDocument('counter_logs', {
      userId: user.uid, counterId: counter.id, date: histAddDate, countAdded: delta, note: null,
    })
    // addDocument returns id via loadData — reload logs
    const logDocs = await queryDocuments('counter_logs', [
      where('userId', '==', user.uid), where('counterId', '==', counter.id), orderBy('date', 'desc'),
    ])
    const updatedLogs: CounterLog[] = logDocs.map(l => ({ id: l.id, date: l.date, countAdded: l.countAdded ?? 1 }))
    setLogs(prev => ({ ...prev, [counter.id]: updatedLogs }))
    await recalcCounterTotal(counter, updatedLogs)
    setHistAddDate(todayDate()); setHistAddCount('1')
  }

  async function deleteLog(counter: Counter, log: CounterLog) {
    await deleteDocument('counter_logs', log.id)
    const updatedLogs = (logs[counter.id] ?? []).filter(l => l.id !== log.id)
    setLogs(prev => ({ ...prev, [counter.id]: updatedLogs }))
    await recalcCounterTotal(counter, updatedLogs)
  }

  async function saveLogEdit(counter: Counter, log: CounterLog) {
    const newCount = parseInt(editLogCount) || 1
    await updateDocument('counter_logs', log.id, { countAdded: newCount })
    const updatedLogs = (logs[counter.id] ?? []).map(l => l.id === log.id ? { ...l, countAdded: newCount } : l)
    setLogs(prev => ({ ...prev, [counter.id]: updatedLogs }))
    await recalcCounterTotal(counter, updatedLogs)
    setEditingLogId(null)
  }

  async function saveCounterEdit() {
    if (!editingCounter) return
    await updateDocument('custom_counters', editingCounter.id, {
      name: editingCounter.name,
      emoji: editingCounter.emoji,
      unit: editingCounter.unit,
      targetCount: editingCounter.targetCount,
      deadline: editingCounter.deadline ?? null,
      color: editingCounter.color,
      reward: editingCounter.reward?.trim() || null,
    })
    setCounters(prev => prev.map(c => c.id === editingCounter.id ? { ...c, ...editingCounter } : c))
    setEditingCounter(null)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading counters...</p></div>

  // Edit modal
  if (editingCounter) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setEditingCounter(null)} className="text-muted text-lg">←</button>
          <h2 className="font-semibold">Edit Counter</h2>
        </div>
        <div className="card space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRESET_EMOJIS.map(e => (
              <button key={e} onClick={() => setEditingCounter(prev => prev ? { ...prev, emoji: e } : null)}
                className="w-9 h-9 rounded-xl text-xl flex items-center justify-center"
                style={{ background: editingCounter.emoji === e ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)', border: editingCounter.emoji === e ? '2px solid #14b8a6' : '1px solid var(--border)' }}>
                {e}
              </button>
            ))}
          </div>
          <input type="text" value={editingCounter.name} onChange={e => setEditingCounter(prev => prev ? { ...prev, name: e.target.value } : null)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Unit</label>
              <input type="text" value={editingCounter.unit} onChange={e => setEditingCounter(prev => prev ? { ...prev, unit: e.target.value } : null)}
                placeholder="sessions, km…" className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Target</label>
              <input type="number" value={editingCounter.targetCount}
                onChange={e => setEditingCounter(prev => prev ? { ...prev, targetCount: parseInt(e.target.value) || 0 } : null)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Deadline</label>
            <input type="date" value={editingCounter.deadline ?? ''}
              onChange={e => setEditingCounter(prev => prev ? { ...prev, deadline: e.target.value || undefined } : null)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">🎁 Reward when completed (optional)</label>
            <input type="text" value={editingCounter.reward ?? ''}
              onChange={e => setEditingCounter(prev => prev ? { ...prev, reward: e.target.value } : null)}
              placeholder="e.g. New running shoes, Weekend trip…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
          <div>
            <label className="text-xs text-muted mb-2 block">Color</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setEditingCounter(prev => prev ? { ...prev, color: c } : null)}
                  className="w-7 h-7 rounded-full"
                  style={{ background: c, border: editingCounter.color === c ? '3px solid white' : '2px solid transparent', outline: editingCounter.color === c ? `2px solid ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditingCounter(null)} className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveCounterEdit} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#14b8a6', color: 'white' }}>Save</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      <p className="text-xs text-muted">Track goals like "Gym 200×", "Podcast 180×", "No Instagram 60 days"</p>

      {showAdd ? (
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">New Counter</h3>
          <div className="flex flex-wrap gap-2">
            {PRESET_EMOJIS.map(e => (
              <button key={e} onClick={() => setNewEmoji(e)}
                className="w-9 h-9 rounded-xl text-xl flex items-center justify-center transition-all"
                style={{ background: newEmoji === e ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)', border: newEmoji === e ? '2px solid #14b8a6' : '1px solid var(--border)' }}>
                {e}
              </button>
            ))}
          </div>
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Counter name (e.g. Gym sessions)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Unit (optional)</label>
              <input type="text" value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="sessions, km…"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Start value</label>
              <input type="number" value={newInitial} onChange={e => setNewInitial(e.target.value)} placeholder="0"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Target</label>
              <input type="number" value={newTarget} onChange={e => setNewTarget(e.target.value)} placeholder="200"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Deadline</label>
              <input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">🎁 Reward when completed (optional)</label>
            <input type="text" value={newReward} onChange={e => setNewReward(e.target.value)}
              placeholder="e.g. New running shoes, Weekend trip…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
          <div>
            <label className="text-xs text-muted mb-2 block">Color</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)} className="w-7 h-7 rounded-full transition-all"
                  style={{ background: c, border: newColor === c ? '3px solid white' : '2px solid transparent', outline: newColor === c ? `2px solid ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={createCounter} disabled={!newName.trim() || !newTarget || saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>{saving ? '...' : 'Create'}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
          <span className="text-lg">+</span> New counter
        </button>
      )}

      {counters.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-sm text-muted">No counters yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {counters.map(counter => {
            const range = Math.max(1, counter.targetCount - counter.initialCount)
            const pct = Math.min(((counter.currentCount - counter.initialCount) / range) * 100, 100)
            const counterLogs = logs[counter.id] ?? []
            const chartData = buildChartData(counter, counterLogs)
            const projection = getProjection(counter, chartData)
            const todayDelta = counterLogs.filter(l => l.date === today).reduce((s, l) => s + l.countAdded, 0)
            const displayUnit = counter.unit ? ` ${counter.unit}` : ''
            const fullChart: ChartPoint[] = projection ? [...chartData, ...projection.projectedPoints] : chartData

            return (
              <div key={counter.id} className="card" style={{ border: `1px solid ${counter.color}30` }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{counter.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{counter.name}</p>
                    <p className="text-xs text-muted">{Math.round(pct)}% · {counter.deadline
                      ? `Due ${new Date(counter.deadline + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                      : 'No deadline'}</p>
                  </div>
                  <button onClick={() => setMenuId(menuId === counter.id ? null : counter.id)}
                    className="text-muted text-base px-1 flex-shrink-0">⋯</button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => changeCount(counter, -1)}
                      disabled={!!actingId || counter.currentCount <= counter.initialCount}
                      className="w-9 h-9 rounded-full text-lg font-bold flex items-center justify-center active:scale-95 disabled:opacity-30 transition-all"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>−</button>
                    <button onClick={() => changeCount(counter, 1)} disabled={!!actingId}
                      className="w-12 h-12 rounded-full text-2xl font-bold flex items-center justify-center active:scale-95 disabled:opacity-50 transition-all"
                      style={{ background: counter.color, color: 'white', boxShadow: `0 4px 14px ${counter.color}40` }}>+</button>
                  </div>
                </div>

                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-bold" style={{ color: counter.color }}>{counter.currentCount}</span>
                  <span className="text-sm text-muted">/ {counter.targetCount}{displayUnit}</span>
                  {todayDelta !== 0 && (
                    <span className="text-xs ml-1" style={{ color: todayDelta > 0 ? '#22c55e' : '#ef4444' }}>
                      ({todayDelta > 0 ? '+' : ''}{todayDelta} today)
                    </span>
                  )}
                </div>

                {fullChart.length >= 1 && (
                  <div className="mb-2">
                    <ResponsiveContainer width="100%" height={110}>
                      <AreaChart data={fullChart} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`g-${counter.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={counter.color} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={counter.color} stopOpacity={0.03} />
                          </linearGradient>
                          <linearGradient id={`gp-${counter.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={counter.color} stopOpacity={0.12} />
                            <stop offset="100%" stopColor={counter.color} stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis domain={[counter.initialCount, counter.targetCount]} hide />
                        <Tooltip
                          formatter={(val: any, name: any) => [`${val}${displayUnit}`, name === 'projected' ? 'Projected' : 'Actual']}
                          labelFormatter={(l: any) => new Date(l + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                        />
                        <ReferenceLine y={counter.targetCount} stroke={counter.color} strokeDasharray="4 2" strokeOpacity={0.4} />
                        <Area type="monotone" dataKey="count" stroke={counter.color} strokeWidth={2} fill={`url(#g-${counter.id})`} dot={false} connectNulls />
                        {projection && (
                          <Area type="monotone" dataKey="projected" stroke={counter.color} strokeWidth={1.5} strokeDasharray="5 3" fill={`url(#gp-${counter.id})`} dot={false} connectNulls />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                    <div className="flex justify-between text-[10px] text-muted px-1 -mt-1">
                      <span>{chartData[0]?.date ? new Date(chartData[0].date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Start'}</span>
                      <span style={{ color: counter.color, fontStyle: 'italic' }}>
                        {projection ? `→ est. ${projection.completionDate}` : 'Today'}
                      </span>
                    </div>
                  </div>
                )}

                {projection && (
                  <div className="px-3 py-2 rounded-lg mb-2 text-xs"
                    style={{ background: `${counter.color}10`, border: `1px solid ${counter.color}20` }}>
                    <p style={{ color: counter.color }}>📅 Expected completion: <strong>{projection.completionDate}</strong></p>
                    <p className="text-muted mt-0.5">{projection.dailyRate}{displayUnit}/day · {projection.daysToComplete} days to go</p>
                  </div>
                )}

                {counter.reward && (
                  <div className="px-3 py-2 rounded-lg mb-2 text-xs"
                    style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
                    <p style={{ color: '#a855f7' }}>🎁 Reward: <strong>{counter.reward}</strong></p>
                  </div>
                )}

                {/* Daily increments bar chart */}
                {counterLogs.length > 0 && (() => {
                  const last14: { date: string; added: number; pct: number }[] = []
                  for (let i = 13; i >= 0; i--) {
                    const d = new Date(); d.setDate(d.getDate() - i)
                    const ds = d.toISOString().split('T')[0]
                    const added = counterLogs.filter(l => l.date === ds).reduce((s, l) => s + l.countAdded, 0)
                    const cumulSoFar = chartData.find(p => p.date === ds)?.count ?? 0
                    const pct = counter.targetCount > 0 ? Math.min(Math.round((cumulSoFar / counter.targetCount) * 100), 100) : 0
                    last14.push({ date: ds, added, pct })
                  }
                  const hasData = last14.some(d => d.added > 0)
                  if (!hasData) return null
                  return (
                    <div className="mt-2 mb-2">
                      <p className="text-[10px] text-muted mb-1 font-semibold uppercase">Daily increments (last 14 days)</p>
                      <ResponsiveContainer width="100%" height={60}>
                        <BarChart data={last14} margin={{ top: 2, right: 2, left: -30, bottom: 0 }}>
                          <XAxis dataKey="date" hide />
                          <YAxis hide />
                          <Tooltip
                            formatter={(val: any) => [`+${val}${displayUnit}`, 'Added']}
                            labelFormatter={(l: any) => new Date(l + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                          />
                          <Bar dataKey="added" radius={[3, 3, 0, 0]}>
                            {last14.map((entry, idx) => (
                              <Cell key={idx} fill={entry.added > 0 ? counter.color : 'var(--surface-2)'} opacity={entry.added > 0 ? 0.85 : 0.3} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex justify-between text-[10px] text-muted px-1">
                        <span>{new Date(last14[0].date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                        <span style={{ color: counter.color }}>
                          {Math.min(Math.round((counter.currentCount / counter.targetCount) * 100), 100)}% of target
                        </span>
                        <span>Today</span>
                      </div>
                    </div>
                  )
                })()}

                {menuId === counter.id && (
                  <div className="flex gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => { setEditingCounter(counter); setMenuId(null) }}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                    <button onClick={() => { setHistoryCounterId(historyCounterId === counter.id ? null : counter.id); setMenuId(null) }}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(129,140,248,0.1)', color: '#818cf8' }}>📋 History</button>
                    <button onClick={() => deleteCounter(counter.id)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🗑️ Delete</button>
                  </div>
                )}

                {/* History panel */}
                {historyCounterId === counter.id && (
                  <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">Log History</p>

                    {/* Add historical entry */}
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted mb-1 block">Date</label>
                        <input type="date" value={histAddDate} onChange={e => setHistAddDate(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      </div>
                      <div className="w-16">
                        <label className="text-[10px] text-muted mb-1 block">Count</label>
                        <input type="number" value={histAddCount} onChange={e => setHistAddCount(e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      </div>
                      <button onClick={() => addHistoricalLog(counter)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
                        style={{ background: counter.color, color: 'white' }}>+ Add</button>
                    </div>

                    {/* Existing log entries */}
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {[...(logs[counter.id] ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map(log => (
                        <div key={log.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                          style={{ background: 'var(--surface-2)' }}>
                          <span className="text-xs text-muted w-20 flex-shrink-0">
                            {new Date(log.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                          {editingLogId === log.id ? (
                            <>
                              <input type="number" value={editLogCount} onChange={e => setEditLogCount(e.target.value)}
                                autoFocus className="w-14 px-2 py-0.5 rounded text-xs outline-none flex-shrink-0"
                                style={{ background: 'var(--background)', border: `1px solid ${counter.color}`, color: 'var(--foreground)' }} />
                              <button onClick={() => saveLogEdit(counter, log)}
                                className="text-xs px-2 py-0.5 rounded font-semibold"
                                style={{ background: counter.color, color: 'white' }}>✓</button>
                              <button onClick={() => setEditingLogId(null)} className="text-xs text-muted">✕</button>
                            </>
                          ) : (
                            <>
                              <span className="text-xs font-semibold flex-1" style={{ color: counter.color }}>
                                {log.countAdded > 0 ? '+' : ''}{log.countAdded}{displayUnit}
                              </span>
                              <button onClick={() => { setEditingLogId(log.id); setEditLogCount(String(log.countAdded)) }}
                                className="text-xs px-1.5 py-0.5 rounded" style={{ color: '#14b8a6' }}>✏️</button>
                              <button onClick={() => deleteLog(counter, log)}
                                className="text-xs px-1.5 py-0.5 rounded" style={{ color: '#ef4444' }}>✕</button>
                            </>
                          )}
                        </div>
                      ))}
                      {(logs[counter.id] ?? []).length === 0 && (
                        <p className="text-xs text-muted text-center py-2">No log entries yet</p>
                      )}
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
