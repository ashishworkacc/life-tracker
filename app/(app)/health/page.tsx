'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, addDocument, updateDocument, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────
interface AppleHealthLog {
  id: string
  date: string
  syncedAt?: string
  source?: string
  weight?: number
  bodyFat?: number
  leanMass?: number
  muscleMass?: number
  boneMass?: number
  bmi?: number
  steps?: number
  activeEnergy?: number
  restingEnergy?: number
  exerciseMinutes?: number
  standHours?: number
  moveRingPct?: number
  exerciseRingPct?: number
  standRingPct?: number
  heartRateAvg?: number
  heartRateResting?: number
  heartRateMax?: number
  hrv?: number
  vo2Max?: number
  spo2?: number
  respiratoryRate?: number
  sleepHours?: number
  sleepDeep?: number
  sleepRem?: number
  sleepScore?: number
}

// ─── Metric config ────────────────────────────────────────────────────────────
const METRIC_GROUPS = [
  {
    label: '⚖️ Body Composition',
    color: '#8b5cf6',
    metrics: [
      { key: 'weight',     label: 'Weight',      unit: 'kg',   fmt: (v: number) => v.toFixed(1) },
      { key: 'bodyFat',    label: 'Body Fat',     unit: '%',    fmt: (v: number) => v.toFixed(1) },
      { key: 'leanMass',   label: 'Lean Mass',    unit: 'kg',   fmt: (v: number) => v.toFixed(1) },
      { key: 'muscleMass', label: 'Muscle Mass',  unit: 'kg',   fmt: (v: number) => v.toFixed(1) },
      { key: 'bmi',        label: 'BMI',          unit: '',     fmt: (v: number) => v.toFixed(1) },
    ],
  },
  {
    label: '❤️ Heart & Vitals',
    color: '#ef4444',
    metrics: [
      { key: 'heartRateResting', label: 'Resting HR',  unit: 'bpm', fmt: (v: number) => Math.round(v).toString() },
      { key: 'heartRateAvg',     label: 'Avg HR',       unit: 'bpm', fmt: (v: number) => Math.round(v).toString() },
      { key: 'hrv',              label: 'HRV',          unit: 'ms',  fmt: (v: number) => Math.round(v).toString() },
      { key: 'vo2Max',           label: 'VO₂ Max',      unit: 'mL/kg/min', fmt: (v: number) => v.toFixed(1) },
      { key: 'spo2',             label: 'SpO₂',         unit: '%',   fmt: (v: number) => Math.round(v).toString() },
    ],
  },
  {
    label: '🏃 Activity',
    color: '#10b981',
    metrics: [
      { key: 'steps',          label: 'Steps',           unit: '',    fmt: (v: number) => v.toLocaleString() },
      { key: 'activeEnergy',   label: 'Active Cal',      unit: 'kcal', fmt: (v: number) => Math.round(v).toString() },
      { key: 'exerciseMinutes',label: 'Exercise',        unit: 'min', fmt: (v: number) => Math.round(v).toString() },
      { key: 'standHours',     label: 'Stand Hours',     unit: 'h',   fmt: (v: number) => Math.round(v).toString() },
    ],
  },
  {
    label: '💤 Sleep',
    color: '#6366f1',
    metrics: [
      { key: 'sleepHours', label: 'Total Sleep', unit: 'h',  fmt: (v: number) => v.toFixed(1) },
      { key: 'sleepDeep',  label: 'Deep Sleep',  unit: 'h',  fmt: (v: number) => v.toFixed(1) },
      { key: 'sleepRem',   label: 'REM Sleep',   unit: 'h',  fmt: (v: number) => v.toFixed(1) },
      { key: 'sleepScore', label: 'Sleep Score', unit: '/100', fmt: (v: number) => Math.round(v).toString() },
    ],
  },
]

const APPLE_WATCH_RINGS = [
  { key: 'moveRingPct',     label: 'Move',     color: '#ef4444' },
  { key: 'exerciseRingPct', label: 'Exercise', color: '#22c55e' },
  { key: 'standRingPct',    label: 'Stand',    color: '#06b6d4' },
]

function Ring({ pct, color, label, size = 64 }: { pct: number; color: string; label: string; size?: number }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} stroke={`${color}25`} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6}
            stroke={color}
            strokeDasharray={`${circ}`}
            strokeDashoffset={`${circ * (1 - Math.min(pct, 100) / 100)}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontSize: size > 60 ? '0.9rem' : '0.65rem', fontWeight: 800, color, lineHeight: 1 }}>{Math.round(pct)}%</span>
        </div>
      </div>
      <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4, fontWeight: 600 }}>{label}</p>
    </div>
  )
}

// Sparkline from last 7 values
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 80, h = 24
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={Number(pts.split(' ').at(-1)?.split(',')[0])} cy={Number(pts.split(' ').at(-1)?.split(',')[1])} r={2.5} fill={color} />
    </svg>
  )
}

// Delta vs previous
function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous
  if (Math.abs(diff) < 0.01) return null
  const isGood = diff > 0 // caller can invert for body fat etc
  return (
    <span style={{ fontSize: '0.68rem', color: diff > 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
      {diff > 0 ? '+' : ''}{diff.toFixed(1)}
    </span>
  )
}

export default function HealthPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [healthLogs, setHealthLogs] = useState<AppleHealthLog[]>([])
  const [todayLog, setTodayLog] = useState<AppleHealthLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'today' | 'trends' | 'setup'>('today')
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Manual override state (for when not yet synced)
  const [manualWeight, setManualWeight] = useState('')
  const [manualBodyFat, setManualBodyFat] = useState('')
  const [manualHR, setManualHR] = useState('')
  const [manualSleep, setManualSleep] = useState('')
  const [savingManual, setSavingManual] = useState(false)

  useEffect(() => {
    if (!user) return
    loadHealthData()
  }, [user])

  async function loadHealthData() {
    setLoading(true)
    try {
      const docs = await queryDocuments('apple_health_logs', [
        where('userId', '==', user!.uid),
        orderBy('date', 'desc'),
        limit(30),
      ])
      const logs = docs.map(d => { const { id: _id, ...rest } = d; return { id: d.id, ...rest } as AppleHealthLog })
      setHealthLogs(logs)
      const td = logs.find(l => l.date === today)
      setTodayLog(td ?? null)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function saveManualEntry() {
    if (!user) return
    setSavingManual(true)
    const payload: Record<string, number | string> = { userId: user.uid, date: today, source: 'manual' }
    if (manualWeight) payload.weight = parseFloat(manualWeight)
    if (manualBodyFat) payload.bodyFat = parseFloat(manualBodyFat)
    if (manualHR) payload.heartRateResting = parseFloat(manualHR)
    if (manualSleep) payload.sleepHours = parseFloat(manualSleep)
    if (Object.keys(payload).length <= 3) { setSavingManual(false); return }
    try {
      const existing = await queryDocuments('apple_health_logs', [
        where('userId', '==', user.uid), where('date', '==', today),
      ])
      let newLog: AppleHealthLog
      if (existing.length > 0) {
        await updateDocument('apple_health_logs', existing[0].id, payload)
        newLog = { ...existing[0], ...payload } as AppleHealthLog
      } else {
        const ref = await addDocument('apple_health_logs', { ...payload, syncedAt: new Date().toISOString() })
        newLog = { id: ref?.id ?? today, ...payload } as AppleHealthLog
      }
      setTodayLog(newLog)
      setHealthLogs(prev => [newLog, ...prev.filter(l => l.date !== today)])
      setManualWeight(''); setManualBodyFat(''); setManualHR(''); setManualSleep('')
    } catch (e) { console.error(e) }
    setSavingManual(false)
  }

  async function generateAiInsight() {
    if (!user || healthLogs.length === 0) return
    setAiLoading(true)
    try {
      const last14 = healthLogs.slice(0, 14).map(l => ({
        date: l.date,
        weight: l.weight, bodyFat: l.bodyFat, leanMass: l.leanMass,
        heartRateResting: l.heartRateResting, hrv: l.hrv, vo2Max: l.vo2Max,
        steps: l.steps, activeEnergy: l.activeEnergy, sleepHours: l.sleepHours,
        sleepDeep: l.sleepDeep,
      }))
      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'health-analysis',
          userId: user.uid,
          data: `Analyse this Apple Health data for the last ${last14.length} days. Focus on:
1. Body composition trend (weight + fat% + lean mass trajectory)
2. Cardiovascular health signals (resting HR, HRV trends — HRV going up = recovery improving)
3. Activity patterns (steps, active energy consistency)
4. Sleep quality impact (deep sleep % of total — ideal is 20%+)
5. One key insight about what the numbers suggest about overall health trajectory

Be specific with numbers. Reference actual data points. Give one prioritised action.

DATA: ${JSON.stringify(last14)}`,
        }),
      })
      const data = await res.json()
      setAiInsight(data.insight ?? '')
    } catch { setAiInsight('Could not generate analysis. Try again.') }
    setAiLoading(false)
  }

  function copyUserId() {
    if (!user) return
    navigator.clipboard.writeText(user.uid).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Build 7-day trend for a given metric key
  function getTrend(key: keyof AppleHealthLog, days = 7): number[] {
    const sorted = [...healthLogs].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
    return sorted.map(l => (l[key] as number | undefined) ?? 0).filter(v => v > 0)
  }

  const last7Weight = getTrend('weight')
  const last7BodyFat = getTrend('bodyFat')
  const last7Steps = getTrend('steps')
  const last7HRV = getTrend('hrv')
  const last7Sleep = getTrend('sleepHours')

  const syncUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/health/apple-sync`
    : 'https://your-app.vercel.app/api/health/apple-sync'

  if (loading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      Loading health data…
    </div>
  )

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1rem 1rem 6rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>🍎 Health Hub</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            Apple Watch + Health data · {healthLogs.length} days logged
          </p>
          {todayLog?.syncedAt && (
            <p style={{ fontSize: '0.72rem', color: '#10b981', margin: '0.15rem 0 0' }}>
              ✓ Last synced {new Date(todayLog.syncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/health/import" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>
            📥 Import ZIP
          </Link>
          <Link href="/trackers/food" style={{ fontSize: '0.75rem', padding: '0.4rem 0.85rem', background: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>
            🥗 Food
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.35rem', background: 'var(--surface)', borderRadius: 10, padding: '3px', marginBottom: '1.25rem', border: '1px solid var(--border)' }}>
        {(['today', 'trends', 'setup'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: '0.82rem', fontWeight: 600,
            background: activeTab === t ? 'var(--color-primary)' : 'transparent',
            color: activeTab === t ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}>
            {t === 'today' ? '📊 Today' : t === 'trends' ? '📈 Trends (30d)' : '🔧 Apple Watch Setup'}
          </button>
        ))}
      </div>

      {/* ─── TODAY TAB ─── */}
      {activeTab === 'today' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Apple Watch Rings */}
          {todayLog && (todayLog.moveRingPct || todayLog.exerciseRingPct || todayLog.standRingPct) && (
            <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1rem' }}>⌚ Activity Rings</h3>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start' }}>
                {APPLE_WATCH_RINGS.map(r => (
                  <Ring key={r.key} pct={(todayLog as any)[r.key] ?? 0} color={r.color} label={r.label} size={72} />
                ))}
              </div>
            </div>
          )}

          {/* Metric groups */}
          {METRIC_GROUPS.map(group => {
            const hasData = group.metrics.some(m => todayLog && (todayLog as any)[m.key] !== undefined)
            if (!hasData && todayLog) return null
            return (
              <div key={group.label} className="card" style={{ border: `1px solid ${group.color}20` }}>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: group.color, marginBottom: '0.75rem' }}>{group.label}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
                  {group.metrics.map(m => {
                    const val = todayLog ? (todayLog as any)[m.key] : undefined
                    const trend = getTrend(m.key as keyof AppleHealthLog, 7)
                    const prev = trend.length >= 2 ? trend[trend.length - 2] : null
                    return (
                      <div key={m.key} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.65rem', position: 'relative' }}>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>{m.label}</p>
                        {val !== undefined ? (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '1.3rem', fontWeight: 800, color: group.color, lineHeight: 1 }}>
                              {m.fmt(val)}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{m.unit}</span>
                            {prev !== null && <Delta current={val} previous={prev} />}
                          </div>
                        ) : (
                          <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                        {trend.length >= 3 && (
                          <div style={{ marginTop: '0.4rem' }}>
                            <Sparkline values={trend} color={group.color} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* No data state */}
          {!todayLog && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', border: '1px solid rgba(20,184,166,0.2)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⌚</p>
              <p style={{ fontWeight: 700, marginBottom: '0.5rem' }}>No Apple Health data yet for today</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                Set up the iOS Shortcut (Setup tab) to auto-sync your Apple Watch data, or log manually below.
              </p>
              <button onClick={() => setActiveTab('setup')} style={{
                background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8,
                padding: '0.6rem 1.25rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
              }}>
                🔧 Set up Apple Watch sync →
              </button>
            </div>
          )}

          {/* Manual entry */}
          <div className="card" style={{ border: '1px solid rgba(148,163,184,0.2)' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.25rem' }}>✏️ Manual Entry</h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Override or supplement auto-synced data for today.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {[
                { key: 'weight', label: 'Weight (kg)', val: manualWeight, set: setManualWeight, placeholder: '70.5' },
                { key: 'bodyFat', label: 'Body Fat (%)', val: manualBodyFat, set: setManualBodyFat, placeholder: '18.2' },
                { key: 'heartRate', label: 'Resting HR (bpm)', val: manualHR, set: setManualHR, placeholder: '62' },
                { key: 'sleep', label: 'Sleep (hours)', val: manualSleep, set: setManualSleep, placeholder: '7.5' },
              ].map(f => (
                <div key={f.key}>
                  <p style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{f.label}</p>
                  <input type="number" step="0.1" value={f.val} onChange={e => f.set(e.target.value)}
                    placeholder={f.placeholder}
                    style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>
            <button onClick={saveManualEntry} disabled={savingManual || (!manualWeight && !manualBodyFat && !manualHR && !manualSleep)}
              style={{ width: '100%', padding: '0.6rem', background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: savingManual ? 0.6 : 1 }}>
              {savingManual ? 'Saving…' : 'Save manual entry'}
            </button>
          </div>

          {/* AI Health Insight */}
          {healthLogs.length >= 3 && (
            <div className="card" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, margin: 0 }}>🤖 AI Health Analysis</h3>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Body composition · Cardiovascular · Recovery trends</p>
                </div>
                <button onClick={generateAiInsight} disabled={aiLoading}
                  style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', opacity: aiLoading ? 0.5 : 1 }}>
                  {aiLoading ? '⏳ Analysing…' : '✨ Analyse'}
                </button>
              </div>
              {aiInsight ? (
                <p style={{ fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiInsight}</p>
              ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tap Analyse to get AI insights on your body composition trends, HRV, and health trajectory.
                </p>
              )}
            </div>
          )}

          {/* Quick links to moved trackers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
            {[
              { href: '/trackers/food', icon: '🥗', label: 'Food Log', desc: 'Macros & calories' },
              { href: '/trackers/sleep', icon: '💤', label: 'Sleep Log', desc: 'Manual sleep entry' },
              { href: '/trackers/weight', icon: '⚖️', label: 'Weight Log', desc: 'History & trends' },
              { href: '/trackers/vitals', icon: '💊', label: 'Vitals & Meds', desc: 'Medications & readings' },
            ].map(l => (
              <Link key={l.href} href={l.href} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.75rem', textDecoration: 'none', display: 'block' }}>
                <span style={{ fontSize: '1.25rem' }}>{l.icon}</span>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0.3rem 0 0.1rem', color: 'var(--text-primary)' }}>{l.label}</p>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ─── TRENDS TAB ─── */}
      {activeTab === 'trends' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {healthLogs.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No health data logged yet. Set up Apple Watch sync or add manual entries.</p>
            </div>
          ) : (
            <>
              {/* 30-day trend tables */}
              {[
                { title: '⚖️ Body Composition', rows: [
                  { label: 'Weight', key: 'weight', unit: 'kg', color: '#8b5cf6' },
                  { label: 'Body Fat %', key: 'bodyFat', unit: '%', color: '#ec4899' },
                  { label: 'Lean Mass', key: 'leanMass', unit: 'kg', color: '#10b981' },
                ]},
                { title: '❤️ Cardiovascular', rows: [
                  { label: 'Resting HR', key: 'heartRateResting', unit: 'bpm', color: '#ef4444' },
                  { label: 'HRV', key: 'hrv', unit: 'ms', color: '#f59e0b' },
                  { label: 'VO₂ Max', key: 'vo2Max', unit: '', color: '#14b8a6' },
                ]},
                { title: '🏃 Activity', rows: [
                  { label: 'Steps', key: 'steps', unit: '', color: '#10b981' },
                  { label: 'Active Cal', key: 'activeEnergy', unit: 'kcal', color: '#f59e0b' },
                  { label: 'Exercise min', key: 'exerciseMinutes', unit: 'min', color: '#6366f1' },
                ]},
                { title: '💤 Sleep', rows: [
                  { label: 'Total Sleep', key: 'sleepHours', unit: 'h', color: '#6366f1' },
                  { label: 'Deep Sleep', key: 'sleepDeep', unit: 'h', color: '#8b5cf6' },
                  { label: 'Sleep Score', key: 'sleepScore', unit: '/100', color: '#14b8a6' },
                ]},
              ].map(section => (
                <div key={section.title} className="card">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>{section.title}</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Metric</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>7d avg</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>14d avg</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Trend</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Sparkline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map(row => {
                          const vals7 = getTrend(row.key as keyof AppleHealthLog, 7)
                          const vals14 = getTrend(row.key as keyof AppleHealthLog, 14)
                          const avg7 = vals7.length ? vals7.reduce((s, v) => s + v, 0) / vals7.length : null
                          const avg14 = vals14.length ? vals14.reduce((s, v) => s + v, 0) / vals14.length : null
                          const delta = avg7 !== null && avg14 !== null ? avg7 - avg14 : null
                          return (
                            <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.5rem 0.5rem', fontWeight: 500, color: row.color }}>{row.label}</td>
                              <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>
                                {avg7 !== null ? avg7.toFixed(1) + ' ' + row.unit : '—'}
                              </td>
                              <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                                {avg14 !== null ? avg14.toFixed(1) + ' ' + row.unit : '—'}
                              </td>
                              <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                                {delta !== null ? (
                                  <span style={{ color: delta > 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                                    {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}
                                  </span>
                                ) : '—'}
                              </td>
                              <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                                <Sparkline values={vals7} color={row.color} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Raw log */}
              <div className="card">
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>📋 Raw log ({healthLogs.length} entries)</h3>
                <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                      <tr>
                        {['Date', 'Weight', 'Fat%', 'HR', 'HRV', 'Steps', 'Sleep', 'Src'].map(h => (
                          <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {healthLogs.map(l => (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: l.date === today ? '#14b8a6' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{l.date}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.weight?.toFixed(1) ?? '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.bodyFat?.toFixed(1) ?? '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.heartRateResting ?? '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.hrv ? Math.round(l.hrv) : '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.steps?.toLocaleString() ?? '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{l.sleepHours?.toFixed(1) ?? '—'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                            {l.source === 'apple_health' || l.source === 'shortcut' ? '⌚' : '✏️'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── SETUP TAB ─── */}
      {activeTab === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* What you get */}
          <div className="card" style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.08), rgba(99,102,241,0.08))', border: '1px solid rgba(20,184,166,0.2)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.5rem' }}>🆓 100% Free — iOS Shortcuts Method</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
              iOS Shortcuts can read directly from HealthKit (your Apple Watch syncs data there automatically).
              A Shortcut sends your health data to this app via a single HTTP request — no paid apps, no subscriptions, no developer account.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem' }}>
              {[
                '⚖️ Weight & Body Fat',
                '💪 Lean & Muscle Mass',
                '❤️ Resting Heart Rate',
                '📊 HRV (recovery)',
                '🫁 VO₂ Max',
                '🩺 SpO₂',
                '👟 Steps & Active Cal',
                '🏋️ Exercise Minutes',
                '🟢 Activity Rings %',
                '💤 Sleep + Deep + REM',
                '🕒 Stand Hours',
                '🌡️ Body Temperature',
              ].map(item => (
                <div key={item} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: 'rgba(20,184,166,0.08)', borderRadius: 6 }}>{item}</div>
              ))}
            </div>
          </div>

          {/* Step 1: Copy userId */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#14b8a6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>1</div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Copy your User ID</h3>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              This goes inside the Shortcut so it knows which account to sync to.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.85rem', fontSize: '0.72rem', wordBreak: 'break-all', color: '#14b8a6', fontFamily: 'monospace' }}>
                {user?.uid ?? 'Loading…'}
              </code>
              <button onClick={copyUserId} style={{ background: copied ? '#10b981' : '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Step 2: Webhook URL */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#8b5cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>2</div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Your Sync Endpoint</h3>
            </div>
            <code style={{ display: 'block', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.85rem', fontSize: '0.72rem', wordBreak: 'break-all', color: '#8b5cf6', fontFamily: 'monospace', marginBottom: '0.5rem' }}>
              {syncUrl}
            </code>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              This is the URL the Shortcut POSTs to. It accepts any health metrics you include.
            </p>
          </div>

          {/* Step 3: Shortcut instructions */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>3</div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Create the iOS Shortcut</h3>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Open the <strong>Shortcuts app</strong> on your iPhone → tap <strong>+</strong> → add these actions in order:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { n: 1, action: 'Find Health Samples', detail: 'Type: Weight · Sort: Date (Latest first) · Limit: 1\n→ Save as "myWeight"' },
                { n: 2, action: 'Find Health Samples', detail: 'Type: Body Fat Percentage · Sort: Date (Latest) · Limit: 1\n→ Save as "myBodyFat"' },
                { n: 3, action: 'Find Health Samples', detail: 'Type: Resting Heart Rate · Sort: Date (Latest) · Limit: 1\n→ Save as "myHR"' },
                { n: 4, action: 'Find Health Samples', detail: 'Type: Heart Rate Variability · Sort: Date (Latest) · Limit: 1\n→ Save as "myHRV"' },
                { n: 5, action: 'Find Health Samples', detail: 'Type: VO2 Max · Sort: Date (Latest) · Limit: 1\n→ Save as "myVO2"' },
                { n: 6, action: 'Find Health Samples', detail: 'Type: Step Count · Sum · Last 24 hours\n→ Save as "mySteps"' },
                { n: 7, action: 'Find Health Samples', detail: 'Type: Active Energy Burned · Sum · Last 24 hours\n→ Save as "myActiveEnergy"' },
                { n: 8, action: 'Find Health Samples', detail: 'Type: Sleep Analysis (In Bed) · Sum · Last 24 hours\n→ Save as "mySleep"' },
                { n: 9, action: 'Get Contents of URL', detail: `URL: ${syncUrl}\nMethod: POST\nRequest Body: JSON\n\nAdd fields:\n• userId → Text → [paste your User ID]\n• date → Date → [Format: YYYY-MM-DD]\n• weight → Number → myWeight (value in kg)\n• bodyFat → Number → myBodyFat (value)\n• heartRateResting → Number → myHR (value)\n• hrv → Number → myHRV (value)\n• vo2Max → Number → myVO2 (value)\n• steps → Number → mySteps\n• activeEnergy → Number → myActiveEnergy\n• sleepHours → Number → mySleep (÷3600 if in seconds)` },
              ].map(step => (
                <div key={step.n} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.75rem', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <span style={{ background: '#14b8a6', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 800, flexShrink: 0 }}>{step.n}</span>
                    <div>
                      <p style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.2rem', color: '#14b8a6' }}>{step.action}</p>
                      <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{step.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 4: Automate */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>4</div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>Automate it (so it runs daily)</h3>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              In the Shortcuts app → <strong>Automation</strong> tab → <strong>+</strong> → <strong>Time of Day</strong>:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {[
                '⏰ Set time to 8:00 AM (or whenever you wake up)',
                '🔁 Repeat: Daily',
                '📱 Run after Apple Watch syncs to iPhone (usually happens overnight)',
                '✅ Select your Shortcut → "Run Immediately" (no notification needed)',
              ].map(tip => (
                <div key={tip} style={{ fontSize: '0.78rem', background: 'rgba(16,185,129,0.07)', borderRadius: 8, padding: '0.4rem 0.75rem' }}>{tip}</div>
              ))}
            </div>
          </div>

          {/* Health Auto Export alternative */}
          <div className="card" style={{ border: '1px solid rgba(245,158,11,0.2)' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem', color: '#f59e0b' }}>
              🔄 Alternative: Health Auto Export App (Free Tier)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Search <strong>"Health Auto Export - Body Data"</strong> on the App Store — free tier allows manual exports.
              In the app, set the webhook URL to your sync endpoint above and include your userId in the payload.
              This can export 80+ metrics including detailed workout data and body composition from scales like Withings/Garmin.
            </p>
          </div>

          {/* Test button */}
          <div className="card" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem' }}>✅ Test your setup</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              After running the Shortcut once, come back here and switch to the <strong>Today</strong> tab.
              Your Apple Watch data should appear within seconds of running the Shortcut.
            </p>
            <button onClick={() => { loadHealthData(); setActiveTab('today') }} style={{
              width: '100%', padding: '0.65rem', background: '#14b8a6', color: '#fff', border: 'none',
              borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
            }}>
              🔄 Refresh & check Today tab
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
