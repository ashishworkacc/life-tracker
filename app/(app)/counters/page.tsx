'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  addDocument, queryDocuments, updateDocument, deleteDocument,
  todayDate, where, orderBy,
} from '@/lib/firebase/db'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
type TimeFilter = 'day' | 'week' | 'month' | 'year' | 'all'

interface Counter {
  id: string
  name: string; emoji: string; unit: string
  targetCount: number; initialCount: number; currentCount: number
  color: string; xpPerIncrement: number
  reward?: string; deadline?: string; createdAt?: string
}

interface CounterLog {
  id: string
  date: string
  countAdded: number
  value?: number        // absolute value (new logs); old logs only have countAdded
  createdAt?: Date      // full timestamp from Firestore
}

interface ChartPoint { label: string; actual?: number; projected?: number }

// ─── Constants ────────────────────────────────────────────────────────────────
const UNIT_OPTIONS = ['Pages', 'Books', 'Classes', 'Movies', 'Hours', 'Minutes', 'km', 'kg', 'Subscribers', 'Sessions']
const PRESET_COLORS = ['#14b8a6', '#818cf8', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#ec4899']
const PRESET_EMOJIS = ['📚', '🏃', '🎯', '💻', '🎸', '🏋️', '🎙️', '✍️', '🧘', '🎬', '💊', '🍎']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(c: Counter) {
  const range = c.targetCount - c.initialCount
  if (range <= 0) return 100
  return Math.min(100, Math.max(0, ((c.currentCount - c.initialCount) / range) * 100))
}

function fmtTs(d?: Date) {
  if (!d) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' at ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function cutoffFor(f: TimeFilter): Date {
  const now = new Date()
  switch (f) {
    case 'day':   return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    case 'week':  { const d = new Date(now); d.setDate(d.getDate() - 7); return d }
    case 'month': { const d = new Date(now); d.setDate(d.getDate() - 30); return d }
    case 'year':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d }
    case 'all':   return new Date(0)
  }
}

function xLabel(d: Date, f: TimeFilter) {
  if (f === 'day') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  if (f === 'year') return d.toLocaleDateString('en-IN', { month: 'short' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Chart builder ────────────────────────────────────────────────────────────
function buildChart(counter: Counter, logs: CounterLog[], filter: TimeFilter) {
  // Sort all logs ascending and reconstruct absolute value for each
  const sorted = [...logs].sort((a, b) =>
    (a.createdAt?.getTime() ?? new Date(a.date).getTime()) -
    (b.createdAt?.getTime() ?? new Date(b.date).getTime())
  )
  let running = counter.initialCount
  const withAbs = sorted.map(l => {
    running = l.value !== undefined ? l.value : running + l.countAdded
    return { ...l, abs: running }
  })

  // Filter to window
  const cutoff = cutoffFor(filter)
  const inWindow = withAbs.filter(l => (l.createdAt ?? new Date(l.date)) >= cutoff)

  const actual: ChartPoint[] = inWindow.map(l => ({
    label: xLabel(l.createdAt ?? new Date(l.date), filter),
    actual: l.abs,
  }))

  // Velocity (units/day) from all history
  let completionDate: string | null = null
  let daysLeft: number | null = null
  let velocity = 0
  const projected: ChartPoint[] = []

  if (withAbs.length >= 2) {
    const firstTs = withAbs[0].createdAt ?? new Date(withAbs[0].date)
    const lastTs  = withAbs[withAbs.length - 1].createdAt ?? new Date(withAbs[withAbs.length - 1].date)
    const daysDiff = Math.max(0.5, (lastTs.getTime() - firstTs.getTime()) / 86_400_000)
    velocity = (counter.currentCount - counter.initialCount) / daysDiff

    if (velocity > 0 && counter.currentCount < counter.targetCount) {
      const remaining = counter.targetCount - counter.currentCount
      daysLeft = Math.ceil(remaining / velocity)
      const completion = new Date()
      completion.setDate(completion.getDate() + daysLeft)
      completionDate = completion.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

      // Build dashed projection points (from today → completion, max 90 days)
      const steps = Math.min(daysLeft, 90)
      // Start at current
      projected.push({ label: xLabel(new Date(), filter === 'day' ? 'week' : filter), projected: counter.currentCount })
      for (let i = 1; i <= Math.min(steps, 10); i++) {
        const d = new Date()
        d.setDate(d.getDate() + Math.round((daysLeft / Math.min(steps, 10)) * i))
        projected.push({
          label: xLabel(d, filter === 'day' ? 'week' : filter),
          projected: Math.round(Math.min(counter.initialCount + velocity * (daysDiff + (daysLeft / Math.min(steps, 10)) * i), counter.targetCount)),
        })
      }
    }
  }

  // Merge for unified chart
  const combined: ChartPoint[] = [
    ...actual,
    ...projected,
  ]

  return { combined, actual, completionDate, daysLeft, velocity: Math.round(velocity * 10) / 10 }
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  const val = payload.find((p: any) => p.value !== undefined)
  if (!val) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 0.1rem' }}>{label}</p>
      <p style={{ fontWeight: 700, color: val.color, margin: 0 }}>{val.value} {unit}</p>
      <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0, fontStyle: val.name === 'projected' ? 'italic' : 'normal' }}>
        {val.name === 'projected' ? 'projected' : 'actual'}
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CountersPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [counters, setCounters] = useState<Counter[]>([])
  const [logs, setLogs] = useState<Record<string, CounterLog[]>>({})
  const [loading, setLoading] = useState(true)

  // View
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selected, setSelected] = useState<Counter | null>(null)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  // Modals
  const [showAdd, setShowAdd] = useState(false)
  const [editingCounter, setEditingCounter] = useState<Counter | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)

  // Log progress form
  const [logMode, setLogMode] = useState<'absolute' | 'delta'>('absolute')
  const [logInput, setLogInput] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  // Add/edit form
  const [fName, setFName] = useState('')
  const [fEmoji, setFEmoji] = useState('📚')
  const [fUnit, setFUnit] = useState('Pages')
  const [fCustomUnit, setFCustomUnit] = useState('')
  const [fInitial, setFInitial] = useState('0')
  const [fTarget, setFTarget] = useState('')
  const [fDeadline, setFDeadline] = useState('')
  const [fColor, setFColor] = useState('#14b8a6')
  const [fReward, setFReward] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    if (!user) return
    const [cDocs, lDocs] = await Promise.all([
      queryDocuments('custom_counters', [where('userId', '==', user.uid)]),
      queryDocuments('counter_logs', [where('userId', '==', user.uid), orderBy('date', 'desc')]),
    ])
    const grouped: Record<string, CounterLog[]> = {}
    for (const l of lDocs) {
      if (!grouped[l.counterId]) grouped[l.counterId] = []
      grouped[l.counterId].push({
        id: l.id, date: l.date,
        countAdded: l.countAdded ?? 0,
        value: l.value,
        createdAt: l.createdAt?.toDate?.() ?? new Date(l.date),
      })
    }
    setLogs(grouped)
    const cs = cDocs.map(c => ({
      id: c.id, name: c.name, emoji: c.emoji ?? '📚', unit: c.unit ?? '',
      targetCount: c.targetCount ?? 100, initialCount: c.initialCount ?? 0,
      currentCount: c.currentCount ?? 0, color: c.color ?? '#14b8a6',
      xpPerIncrement: c.xpPerIncrement ?? 15,
      reward: c.reward ?? '', deadline: c.deadline,
      createdAt: c.createdAt?.toDate?.()?.toISOString?.() ?? (typeof c.createdAt === 'string' ? c.createdAt : undefined),
    }))
    setCounters(cs)
    setLoading(false)
    // Sync selected counter if in detail view
    if (selected) {
      const refreshed = cs.find(c => c.id === selected.id)
      if (refreshed) setSelected(refreshed)
    }
  }

  // ── Open detail ──────────────────────────────────────────────────────────
  function openDetail(c: Counter) {
    setSelected(c); setView('detail'); setTimeFilter('all')
  }
  function backToList() {
    setView('list'); setSelected(null)
  }

  // ── Log progress ─────────────────────────────────────────────────────────
  function openLog() {
    if (!selected) return
    setLogInput(String(selected.currentCount))
    setLogMode('absolute')
    setShowLog(true)
  }

  async function saveLog() {
    if (!user || !selected || logSaving) return
    const parsed = parseFloat(logInput)
    if (isNaN(parsed)) return

    let newValue: number
    if (logMode === 'absolute') {
      newValue = Math.max(selected.initialCount, parsed)
    } else {
      newValue = Math.max(selected.initialCount, selected.currentCount + parsed)
    }
    const delta = newValue - selected.currentCount
    if (delta === 0 && logMode === 'absolute') { setShowLog(false); return }

    setLogSaving(true)
    const milestoneXp: Record<number, number> = { 25: 100, 50: 200, 75: 300, 100: 500 }
    let bonusXp = 0
    for (const [pctStr, xp] of Object.entries(milestoneXp)) {
      const threshold = Math.round((parseInt(pctStr) / 100) * (selected.targetCount - selected.initialCount)) + selected.initialCount
      if (selected.currentCount < threshold && newValue >= threshold) bonusXp = xp
    }

    await Promise.all([
      updateDocument('custom_counters', selected.id, { currentCount: newValue }),
      addDocument('counter_logs', {
        userId: user.uid, counterId: selected.id,
        date: today, countAdded: delta, value: newValue,
      }),
      ...(delta > 0 ? [addDocument('xp_events', {
        userId: user.uid, date: today, eventType: 'counter',
        xpEarned: selected.xpPerIncrement + bonusXp,
        description: `${selected.emoji} ${selected.name}: ${newValue} ${selected.unit}${bonusXp ? ` (+${bonusXp} milestone XP!)` : ''}`,
      })] : []),
    ])

    setSelected({ ...selected, currentCount: newValue })
    setShowLog(false); setLogSaving(false)
    await load()
  }

  // ── Create / Edit tracker ────────────────────────────────────────────────
  function openAdd() {
    setEditingCounter(null)
    setFName(''); setFEmoji('📚'); setFUnit('Pages'); setFCustomUnit('')
    setFInitial('0'); setFTarget(''); setFDeadline(''); setFColor('#14b8a6'); setFReward('')
    setShowAdd(true)
  }
  function openEdit(c: Counter) {
    setEditingCounter(c)
    setFName(c.name); setFEmoji(c.emoji)
    const isPreset = UNIT_OPTIONS.includes(c.unit)
    setFUnit(isPreset ? c.unit : 'Custom'); setFCustomUnit(isPreset ? '' : c.unit)
    setFInitial(String(c.initialCount)); setFTarget(String(c.targetCount))
    setFDeadline(c.deadline ?? ''); setFColor(c.color); setFReward(c.reward ?? '')
    setShowAdd(true); setMenuId(null)
  }

  async function saveTracker() {
    if (!user || !fName.trim() || !fTarget) return
    setFormSaving(true)
    const unit = fUnit === 'Custom' ? fCustomUnit.trim() || 'units' : fUnit
    const initial = parseFloat(fInitial) || 0
    const payload = {
      userId: user.uid, name: fName.trim(), emoji: fEmoji, unit,
      targetCount: parseFloat(fTarget), initialCount: initial,
      deadline: fDeadline || null, color: fColor,
      xpPerIncrement: 15, reward: fReward.trim() || null,
    }
    if (editingCounter) {
      await updateDocument('custom_counters', editingCounter.id, payload)
    } else {
      await addDocument('custom_counters', { ...payload, currentCount: initial })
    }
    setShowAdd(false); setFormSaving(false)
    await load()
  }

  async function deleteCounter(c: Counter) {
    if (!user) return
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    await deleteDocument('custom_counters', c.id)
    setMenuId(null)
    if (selected?.id === c.id) backToList()
    await load()
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading trackers…</div>
  )

  const detailLogs = selected ? (logs[selected.id] ?? []) : []
  const chart = selected ? buildChart(selected, detailLogs, timeFilter) : null
  const detailPct = selected ? pct(selected) : 0
  const histSorted = [...detailLogs].sort((a, b) =>
    (b.createdAt?.getTime() ?? new Date(b.date).getTime()) -
    (a.createdAt?.getTime() ?? new Date(a.date).getTime())
  )

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1rem 1rem 6rem' }}>

      {/* ─── DETAIL VIEW ─────────────────────────────────────────────────── */}
      {view === 'detail' && selected && (
        <>
          {/* Back + header */}
          <div style={{ marginBottom: '1rem' }}>
            <button onClick={backToList} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 0 0.5rem' }}>
              ← Progress
            </button>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>{selected.emoji} {selected.name}</h1>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
                  {selected.currentCount} / {selected.targetCount} {selected.unit}
                </p>
              </div>
              {/* Circular progress */}
              <div style={{ position: 'relative', width: 64, height: 64 }}>
                <svg width={64} height={64} style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx={32} cy={32} r={26} fill="none" strokeWidth={5} stroke={`${selected.color}25`} />
                  <circle cx={32} cy={32} r={26} fill="none" strokeWidth={5} stroke={selected.color}
                    strokeDasharray={`${(detailPct / 100) * 2 * Math.PI * 26} ${2 * Math.PI * 26}`}
                    strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.72rem', fontWeight: 800, color: selected.color }}>
                  {Math.round(detailPct)}%
                </div>
              </div>
            </div>
          </div>

          {/* Time filter tabs */}
          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
            {(['day','week','month','year','all'] as TimeFilter[]).map(f => (
              <button key={f} onClick={() => setTimeFilter(f)} style={{
                padding: '0.35rem 0.75rem', borderRadius: 99, border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.15s',
                background: timeFilter === f ? selected.color : 'var(--surface-2)',
                color: timeFilter === f ? '#fff' : 'var(--text-muted)',
              }}>
                {f === 'all' ? 'All-Time' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Cumulative chart */}
          <div className="card" style={{ border: `1px solid ${selected.color}25`, marginBottom: '0.85rem', padding: '0.75rem' }}>
            {chart && chart.combined.length >= 2 ? (
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={chart.combined} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id={`grad-${selected.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={selected.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={selected.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} domain={[selected.initialCount, selected.targetCount]} />
                  <Tooltip content={(p) => <ChartTip {...p} unit={selected.unit} />} />
                  <Area type="monotone" dataKey="actual" stroke={selected.color} strokeWidth={2.5}
                    fill={`url(#grad-${selected.id})`} dot={false} activeDot={{ r: 4 }}
                    connectNulls name="actual" />
                  <Line type="monotone" dataKey="projected" stroke={selected.color} strokeWidth={2}
                    strokeDasharray="6 4" dot={false} connectNulls name="projected" strokeOpacity={0.7} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No data in this window — log some progress!
              </div>
            )}
          </div>

          {/* Trends */}
          {chart?.completionDate && (
            <div className="card" style={{ marginBottom: '0.85rem', padding: '0.75rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trends</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--surface-2)', borderRadius: 10, padding: '0.65rem 0.85rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Projected Completion</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{chart.completionDate}</span>
              </div>
              {chart.velocity > 0 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.4rem 0 0', textAlign: 'center' }}>
                  at current pace of {chart.velocity} {selected.unit.toLowerCase()}/day · {chart.daysLeft} days to go
                </p>
              )}
            </div>
          )}

          {/* History */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>History</p>
            {histSorted.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No logs yet — tap "Log Progress" to start</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {histSorted.map((l, i) => {
                  // Reconstruct absolute value for display
                  const absVal = l.value ?? (() => {
                    let v = selected.initialCount
                    for (const ll of [...detailLogs].sort((a, b) =>
                      (a.createdAt?.getTime() ?? new Date(a.date).getTime()) -
                      (b.createdAt?.getTime() ?? new Date(b.date).getTime())
                    )) {
                      v = ll.value !== undefined ? ll.value : v + ll.countAdded
                      if (ll.id === l.id) break
                    }
                    return v
                  })()
                  return (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.5rem 0', borderBottom: i < histSorted.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>{absVal} {selected.unit}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fmtTs(l.createdAt)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Log Progress FAB */}
          <button onClick={openLog} style={{
            position: 'fixed', bottom: '5rem', right: '1.25rem', zIndex: 50,
            background: selected.color, color: '#fff', border: 'none', borderRadius: '50%',
            width: 52, height: 52, fontSize: '1.4rem', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>+</button>
        </>
      )}

      {/* ─── LIST VIEW ───────────────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>📈 Progress</h1>
            <button onClick={openAdd} style={{
              background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '0.45rem 1rem', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
            }}>+ New Tracker</button>
          </div>

          {counters.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2.5rem', border: '1px solid rgba(20,184,166,0.2)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</p>
              <p style={{ fontWeight: 700, marginBottom: '0.4rem' }}>No trackers yet</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Track books, classes, km run — anything with a goal.</p>
              <button onClick={openAdd} style={{ background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.4rem', fontWeight: 700, cursor: 'pointer' }}>
                Create your first tracker
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {counters.map(c => {
                const p = pct(c)
                return (
                  <div key={c.id} onClick={() => openDetail(c)} style={{
                    position: 'relative', borderRadius: 14, cursor: 'pointer',
                    background: p > 0
                      ? `linear-gradient(to right, ${c.color}22 ${p}%, var(--surface) ${p}%)`
                      : 'var(--surface)',
                    border: `1px solid ${c.color}30`,
                    padding: '0.85rem 1rem', transition: 'all 0.2s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.005)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >

                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: '0.95rem', margin: '0 0 0.2rem' }}>
                          {c.emoji} {c.name}
                        </p>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                          {c.currentCount} / {c.targetCount} {c.unit}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 800, color: c.color }}>{Math.round(p)}%</span>
                        <button
                          onClick={e => { e.stopPropagation(); setMenuId(menuId === c.id ? null : c.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', padding: '0.2rem', lineHeight: 1 }}
                        >⋯</button>
                      </div>
                    </div>

                    {/* Menu */}
                    {menuId === c.id && (
                      <div onClick={e => e.stopPropagation()} style={{
                        position: 'absolute', top: '100%', right: 8, zIndex: 20, marginTop: 4,
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 120, overflow: 'hidden',
                      }}>
                        {[
                          { label: '✏️ Edit',   action: () => openEdit(c) },
                          { label: '🗑️ Delete', action: () => deleteCounter(c), red: true },
                        ].map(item => (
                          <button key={item.label} onClick={item.action} style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '0.55rem 0.85rem', background: 'none', border: 'none',
                            cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                            color: item.red ? '#ef4444' : 'var(--text-primary)',
                          }}>{item.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ─── LOG PROGRESS MODAL ──────────────────────────────────────────── */}
      {showLog && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowLog(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', borderRadius: '16px 16px 0 0', padding: '1.25rem 1.25rem 2.5rem',
            width: '100%', maxWidth: 480,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <p style={{ fontWeight: 800, fontSize: '1rem', margin: 0 }}>Log Progress — {selected.name}</p>
              <button onClick={() => setShowLog(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            {/* Mode toggle */}
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, marginBottom: '1rem', gap: '0.25rem' }}>
              {(['absolute','delta'] as const).map(m => (
                <button key={m} onClick={() => { setLogMode(m); setLogInput(m === 'absolute' ? String(selected.currentCount) : '1') }} style={{
                  flex: 1, padding: '0.4rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: '0.78rem', fontWeight: 600,
                  background: logMode === m ? selected.color : 'transparent',
                  color: logMode === m ? '#fff' : 'var(--text-muted)',
                }}>
                  {m === 'absolute' ? `Current value` : `Add amount`}
                </button>
              ))}
            </div>

            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              {logMode === 'absolute' ? `Where are you now? (${selected.unit})` : `How much to add? (${selected.unit})`}
            </label>
            <input
              type="number" value={logInput} onChange={e => setLogInput(e.target.value)}
              autoFocus
              style={{
                width: '100%', padding: '0.7rem 0.85rem', borderRadius: 10, fontSize: '1.2rem', fontWeight: 700,
                border: `2px solid ${selected.color}`, background: 'var(--surface-2)', color: 'var(--text-primary)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {(() => {
              const parsed = parseFloat(logInput)
              if (isNaN(parsed)) return null
              const newVal = logMode === 'absolute' ? Math.max(selected.initialCount, parsed) : Math.max(selected.initialCount, selected.currentCount + parsed)
              const delta = newVal - selected.currentCount
              if (delta === 0) return null
              return (
                <p style={{ fontSize: '0.78rem', color: delta > 0 ? '#10b981' : '#ef4444', margin: '0.4rem 0 0', fontWeight: 600 }}>
                  {delta > 0 ? '+' : ''}{delta} {selected.unit} · {Math.round(pct({ ...selected, currentCount: newVal }))}% complete
                </p>
              )
            })()}

            <button onClick={saveLog} disabled={logSaving} style={{
              width: '100%', marginTop: '1rem', padding: '0.75rem', borderRadius: 10, border: 'none',
              background: selected.color, color: '#fff', fontWeight: 700, fontSize: '0.95rem',
              cursor: logSaving ? 'wait' : 'pointer', opacity: logSaving ? 0.7 : 1,
            }}>
              {logSaving ? 'Saving…' : 'Save Progress'}
            </button>
          </div>
        </div>
      )}

      {/* ─── ADD / EDIT TRACKER MODAL ─────────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', borderRadius: '16px 16px 0 0',
            padding: '1.25rem 1.25rem 2.5rem', width: '100%', maxWidth: 480,
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <p style={{ fontWeight: 800, fontSize: '1rem', margin: 0 }}>{editingCounter ? 'Edit Tracker' : 'Add Tracker'}</p>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            {/* Name */}
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Name</label>
            <input value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Seven Moons of Maali Book"
              style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '0.85rem', boxSizing: 'border-box', outline: 'none' }} />

            {/* Emoji */}
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>Emoji</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.85rem' }}>
              {PRESET_EMOJIS.map(e => (
                <button key={e} onClick={() => setFEmoji(e)} style={{
                  width: 36, height: 36, borderRadius: 8, border: fEmoji === e ? '2px solid #14b8a6' : '1px solid var(--border)',
                  background: fEmoji === e ? 'rgba(20,184,166,0.1)' : 'var(--surface-2)', cursor: 'pointer', fontSize: '1.1rem',
                }}>{e}</button>
              ))}
            </div>

            {/* Initial + Target */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.85rem' }}>
              {[
                { label: 'Initial Value', val: fInitial, set: setFInitial, ph: '0' },
                { label: 'Target Value', val: fTarget, set: setFTarget, ph: 'e.g. 386' },
              ].map(f => (
                <div key={f.label}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                    style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.88rem', boxSizing: 'border-box', outline: 'none' }} />
                </div>
              ))}
            </div>

            {/* Unit */}
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>Unit</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: fUnit === 'Custom' ? '0.5rem' : '0.85rem' }}>
              {UNIT_OPTIONS.map(u => (
                <button key={u} onClick={() => setFUnit(u)} style={{
                  padding: '0.3rem 0.65rem', borderRadius: 99, border: fUnit === u ? '2px solid #14b8a6' : '1px solid var(--border)',
                  background: fUnit === u ? 'rgba(20,184,166,0.1)' : 'var(--surface-2)',
                  color: fUnit === u ? '#14b8a6' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                }}>{u}</button>
              ))}
            </div>
            {fUnit === 'Custom' && (
              <input value={fCustomUnit} onChange={e => setFCustomUnit(e.target.value)} placeholder="Enter custom unit"
                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '0.85rem', boxSizing: 'border-box', outline: 'none' }} />
            )}

            {/* Color */}
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>Color</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setFColor(c)} style={{
                  width: 28, height: 28, borderRadius: '50%', border: fColor === c ? '3px solid white' : '3px solid transparent',
                  background: c, cursor: 'pointer', outline: fColor === c ? `2px solid ${c}` : 'none',
                }} />
              ))}
            </div>

            {/* Deadline + Reward */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Deadline (optional)</label>
                <input type="date" value={fDeadline} onChange={e => setFDeadline(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Reward (optional)</label>
                <input value={fReward} onChange={e => setFReward(e.target.value)} placeholder="🎉 treat yourself"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box', outline: 'none' }} />
              </div>
            </div>

            <button onClick={saveTracker} disabled={formSaving || !fName.trim() || !fTarget} style={{
              width: '100%', padding: '0.75rem', borderRadius: 10, border: 'none',
              background: !fName.trim() || !fTarget ? 'var(--surface-2)' : '#14b8a6',
              color: !fName.trim() || !fTarget ? 'var(--text-muted)' : '#fff',
              fontWeight: 700, fontSize: '0.95rem', cursor: formSaving ? 'wait' : 'pointer',
            }}>
              {formSaving ? 'Saving…' : editingCounter ? 'Save Changes' : 'Create Tracker'}
            </button>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {menuId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setMenuId(null)} />
      )}
    </div>
  )
}
