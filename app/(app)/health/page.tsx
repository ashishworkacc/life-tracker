'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, todayDate, where } from '@/lib/firebase/db'
import Link from 'next/link'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface HealthLog {
  id: string; date: string; syncedAt?: string
  weight?: number; bodyFat?: number; leanMass?: number; bmi?: number
  heartRateResting?: number; heartRateAvg?: number; hrv?: number
  vo2Max?: number; spo2?: number; respiratoryRate?: number
  steps?: number; activeEnergy?: number; restingEnergy?: number
  exerciseMinutes?: number; standHours?: number
  sleepHours?: number; sleepDeep?: number; sleepRem?: number; sleepCore?: number
  bloodPressureSystolic?: number; bloodPressureDiastolic?: number
}

interface WorkoutLog {
  id: string; date: string; startDate: string; endDate: string
  type: string; duration: number
  calories?: number; distance?: number; distanceUnit?: string
  avgHR?: number; maxHR?: number; source?: string
}

// ─── Workout config ───────────────────────────────────────────────────────────
const WORKOUT_INFO: Record<string, { name: string; icon: string; color: string }> = {
  HKWorkoutActivityTypeWalking:                    { name: 'Walking',           icon: '🚶', color: '#10b981' },
  HKWorkoutActivityTypeRunning:                    { name: 'Running',           icon: '🏃', color: '#f59e0b' },
  HKWorkoutActivityTypeCycling:                    { name: 'Cycling',           icon: '🚴', color: '#3b82f6' },
  HKWorkoutActivityTypeSwimming:                   { name: 'Swimming',          icon: '🏊', color: '#06b6d4' },
  HKWorkoutActivityTypeYoga:                       { name: 'Yoga',              icon: '🧘', color: '#8b5cf6' },
  HKWorkoutActivityTypeTraditionalStrengthTraining:{ name: 'Strength',          icon: '💪', color: '#ef4444' },
  HKWorkoutActivityTypeFunctionalStrengthTraining: { name: 'Functional',        icon: '🏋️', color: '#f97316' },
  HKWorkoutActivityTypeHighIntensityIntervalTraining: { name: 'HIIT',           icon: '⚡', color: '#eab308' },
  HKWorkoutActivityTypeBadminton:                  { name: 'Badminton',         icon: '🏸', color: '#14b8a6' },
  HKWorkoutActivityTypeElliptical:                 { name: 'Elliptical',        icon: '🔄', color: '#a78bfa' },
  HKWorkoutActivityTypeCrossTraining:              { name: 'Cross Training',    icon: '🤸', color: '#ec4899' },
  HKWorkoutActivityTypePilates:                    { name: 'Pilates',           icon: '🧗', color: '#64748b' },
  HKWorkoutActivityTypeDance:                      { name: 'Dance',             icon: '💃', color: '#f43f5e' },
  HKWorkoutActivityTypeStairClimbing:              { name: 'Stairs',            icon: '🪜', color: '#84cc16' },
  HKWorkoutActivityTypeRowing:                     { name: 'Rowing',            icon: '🚣', color: '#0ea5e9' },
}
function workoutInfo(type: string) {
  return WORKOUT_INFO[type] ?? { name: type.replace('HKWorkoutActivityType','').replace(/([A-Z])/g,' $1').trim(), icon: '🏅', color: '#94a3b8' }
}

// ─── Small ring SVG ───────────────────────────────────────────────────────────
function Ring({ pct, color, label, size = 58 }: { pct: number; color: string; label: string; size?: number }) {
  const r = size / 2 - 5, circ = 2 * Math.PI * r, dash = circ * Math.min(pct, 100) / 100
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={5} stroke={`${color}25`} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={5} stroke={color}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.8s' }} />
      </svg>
      <p style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: 2 }}>{label}</p>
    </div>
  )
}

// ─── Sleep stage bar ──────────────────────────────────────────────────────────
function SleepBar({ deep = 0, rem = 0, core = 0, total = 0 }: { deep?: number; rem?: number; core?: number; total?: number }) {
  const other = Math.max(0, total - deep - rem - core)
  const segments = [
    { label: 'Deep', val: deep,  color: '#4f46e5' },
    { label: 'REM',  val: rem,   color: '#8b5cf6' },
    { label: 'Core', val: core,  color: '#14b8a6' },
    { label: 'Light',val: other, color: '#94a3b8' },
  ].filter(s => s.val > 0)
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 2, marginBottom: '0.5rem' }}>
        {segments.map(s => (
          <div key={s.label} style={{ flex: s.val, background: s.color, minWidth: s.val > 0 ? 4 : 0, borderRadius: 99 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {segments.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.label} {s.val.toFixed(1)}h</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, unit, prev, color, icon }: { label: string; value?: number; unit?: string; prev?: number; color: string; icon: string }) {
  const delta = value !== undefined && prev !== undefined ? value - prev : null
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${color}22`, borderRadius: 12, padding: '0.75rem 1rem' }}>
      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, margin: '0 0 0.3rem' }}>{icon} {label}</p>
      {value !== undefined ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{value % 1 === 0 ? value : value.toFixed(1)}</span>
          {unit && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{unit}</span>}
          {delta !== null && Math.abs(delta) > 0.05 && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: delta > 0 ? '#22c55e' : '#ef4444' }}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
            </span>
          )}
        </div>
      ) : <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>—</span>}
    </div>
  )
}

// ─── Custom chart tooltip ─────────────────────────────────────────────────────
function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}>
      <p style={{ margin: '0 0 0.2rem', color: 'var(--text-muted)' }}>{label}</p>
      <p style={{ margin: 0, fontWeight: 700, color: payload[0].color }}>{payload[0].value?.toFixed(1)} {unit}</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function HealthPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([])
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([])
  const [todayLog, setTodayLog] = useState<HealthLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'today' | 'trends' | 'workouts'>('today')

  useEffect(() => { if (user) load() }, [user])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      // Query without orderBy/limit to avoid composite index requirement (sort client-side)
      const [hDocs, wDocs] = await Promise.all([
        queryDocuments('apple_health_logs', [where('userId', '==', user!.uid)]),
        queryDocuments('workout_logs',      [where('userId', '==', user!.uid)]),
      ])
      // Sort descending by date, take last 30 days / 60 workouts
      const logs = hDocs
        .map(d => { const { id: _id, ...r } = d; return { id: d.id, ...r } as HealthLog })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30)
      const wkts = wDocs
        .map(d => { const { id: _id, ...r } = d; return { id: d.id, ...r } as WorkoutLog })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 60)
      setHealthLogs(logs)
      setWorkouts(wkts)
      setTodayLog(logs.find(l => l.date === today) ?? null)
    } catch (e: any) {
      console.error('Health load error:', e)
      setLoadError(String(e?.message ?? e))
    }
    setLoading(false)
  }

  // Build chart data (sorted asc)
  const sorted30 = [...healthLogs].sort((a, b) => a.date.localeCompare(b.date))
  const chartFmt = (d: string) => d.substring(5) // "05-14"

  function chartData(key: keyof HealthLog) {
    return sorted30.filter(l => l[key] !== undefined).map(l => ({ date: chartFmt(l.date), value: l[key] as number }))
  }

  // Previous day (for delta)
  const prevLog = healthLogs.length > 1 ? healthLogs[1] : null

  // Workout summary
  const totalWorkoutTime = workouts.reduce((s, w) => s + (w.duration ?? 0), 0)
  const totalWorkoutCal  = workouts.reduce((s, w) => s + (w.calories ?? 0), 0)
  const workoutTypeCounts = workouts.reduce((acc, w) => {
    acc[w.type] = (acc[w.type] ?? 0) + 1; return acc
  }, {} as Record<string, number>)

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading health data…</div>

  if (loadError) return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '1.25rem' }}>
        <p style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.4rem' }}>⚠️ Could not load health data</p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.85rem', fontFamily: 'monospace' }}>{loadError}</p>
        <button onClick={load} style={{ background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
      </div>
    </div>
  )

  const hasData = healthLogs.length > 0

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1rem 1rem 6rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>🍎 Health Hub</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            Apple Watch · {healthLogs.length} days · {workouts.length} workouts
            {todayLog?.syncedAt && ` · synced ${new Date(todayLog.syncedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={load} disabled={loading} style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 8, padding: '0.45rem 0.85rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
            {loading ? '…' : '↺ Refresh'}
          </button>
          <Link href="/health/import" style={{ background: '#10b981', color: '#fff', borderRadius: 8, padding: '0.45rem 1rem', textDecoration: 'none', fontWeight: 700, fontSize: '0.8rem' }}>
            📥 Import ZIP
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 10, padding: 3, marginBottom: '1rem', border: '1px solid var(--border)', gap: '0.25rem' }}>
        {([['today','📊 Today'],['trends','📈 Trends'],['workouts','🏋️ Workouts']] as const).map(([t, lbl]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
            background: tab === t ? 'var(--color-primary)' : 'transparent',
            color: tab === t ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s',
          }}>{lbl}</button>
        ))}
      </div>

      {/* No data state */}
      {!hasData && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', border: '1px solid rgba(20,184,166,0.2)' }}>
          <p style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⌚</p>
          <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.4rem' }}>No health data imported yet</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Export from iPhone → Health → Profile → Export All Health Data, then upload the ZIP.
          </p>
          <Link href="/health/import" style={{ background: '#14b8a6', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '0.65rem 1.5rem', fontWeight: 700, fontSize: '0.85rem' }}>
            📥 Import Apple Health data
          </Link>
        </div>
      )}

      {/* ─── TODAY ─────────────────────────────────────────────────────────── */}
      {tab === 'today' && hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

          {/* Body Composition */}
          <div className="card" style={{ border: '1px solid rgba(139,92,246,0.2)' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#8b5cf6', margin: '0 0 0.85rem' }}>⚖️ Body Composition</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: '0.5rem', marginBottom: todayLog?.bodyFat ? '1rem' : 0 }}>
              <StatCard label="Weight" value={todayLog?.weight} unit="kg" prev={prevLog?.weight} color="#8b5cf6" icon="⚖️" />
              <StatCard label="Body Fat" value={todayLog?.bodyFat} unit="%" prev={prevLog?.bodyFat} color="#ec4899" icon="📊" />
              <StatCard label="Lean Mass" value={todayLog?.leanMass} unit="kg" prev={prevLog?.leanMass} color="#10b981" icon="💪" />
              <StatCard label="BMI" value={todayLog?.bmi} unit="" prev={prevLog?.bmi} color="#f59e0b" icon="📐" />
            </div>

            {/* Body composition bar */}
            {todayLog?.bodyFat && todayLog?.weight && (() => {
              const fatPct = todayLog.bodyFat!
              const leanPct = 100 - fatPct
              const fatKg = (todayLog.weight! * fatPct / 100)
              const leanKg = todayLog.weight! - fatKg
              return (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', marginBottom: '0.4rem' }}>
                    <div style={{ flex: fatPct, background: 'linear-gradient(90deg,#ec4899,#f97316)', borderRadius: '99px 0 0 99px' }} />
                    <div style={{ flex: leanPct, background: 'linear-gradient(90deg,#10b981,#14b8a6)', borderRadius: '0 99px 99px 0' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    <span style={{ color: '#ec4899', fontWeight: 700 }}>🔴 Fat {fatPct.toFixed(1)}% · {fatKg.toFixed(1)} kg</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>🟢 Lean {leanPct.toFixed(1)}% · {leanKg.toFixed(1)} kg</span>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Heart & Recovery */}
          <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ef4444', margin: '0 0 0.75rem' }}>❤️ Heart & Recovery</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: '0.5rem' }}>
              <StatCard label="Resting HR" value={todayLog?.heartRateResting} unit="bpm" prev={prevLog?.heartRateResting} color="#ef4444" icon="❤️" />
              <StatCard label="Avg HR" value={todayLog?.heartRateAvg} unit="bpm" prev={prevLog?.heartRateAvg} color="#f97316" icon="💓" />
              <StatCard label="HRV" value={todayLog?.hrv} unit="ms" prev={prevLog?.hrv} color="#f59e0b" icon="📈" />
              <StatCard label="VO₂ Max" value={todayLog?.vo2Max} unit="ml/kg" prev={prevLog?.vo2Max} color="#14b8a6" icon="🫁" />
              <StatCard label="SpO₂" value={todayLog?.spo2} unit="%" prev={prevLog?.spo2} color="#6366f1" icon="🩺" />
            </div>
            {todayLog?.hrv && (() => {
              const all7HRV = healthLogs.slice(0, 7).map(l => l.hrv).filter(Boolean) as number[]
              const avg7HRV = all7HRV.length ? all7HRV.reduce((a, b) => a + b, 0) / all7HRV.length : null
              const status = avg7HRV && todayLog.hrv
                ? todayLog.hrv > avg7HRV * 1.1 ? { label: 'Above baseline — good recovery day ✅', color: '#10b981' }
                  : todayLog.hrv < avg7HRV * 0.9 ? { label: 'Below baseline — prioritise rest 🔴', color: '#ef4444' }
                  : { label: 'Near baseline — normal recovery ✅', color: '#f59e0b' }
                : null
              return status ? (
                <div style={{ marginTop: '0.65rem', background: `${status.color}12`, border: `1px solid ${status.color}30`, borderRadius: 8, padding: '0.4rem 0.75rem', fontSize: '0.75rem', color: status.color, fontWeight: 600 }}>
                  HRV: {status.label}
                </div>
              ) : null
            })()}
          </div>

          {/* Activity */}
          <div className="card" style={{ border: '1px solid rgba(16,185,129,0.2)' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#10b981', margin: '0 0 0.75rem' }}>🏃 Activity</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: '0.5rem' }}>
              <StatCard label="Steps" value={todayLog?.steps} unit="" prev={prevLog?.steps} color="#10b981" icon="👟" />
              <StatCard label="Active Cal" value={todayLog?.activeEnergy} unit="kcal" prev={prevLog?.activeEnergy} color="#f59e0b" icon="🔥" />
              <StatCard label="Exercise" value={todayLog?.exerciseMinutes} unit="min" prev={prevLog?.exerciseMinutes} color="#3b82f6" icon="🏋️" />
              <StatCard label="Stand" value={todayLog?.standHours} unit="h" prev={prevLog?.standHours} color="#14b8a6" icon="🕐" />
            </div>
          </div>

          {/* Sleep */}
          <div className="card" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6366f1', margin: 0 }}>💤 Sleep</p>
              {todayLog?.sleepHours && (
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: todayLog.sleepHours >= 7 ? '#10b981' : '#f59e0b', lineHeight: 1 }}>
                  {todayLog.sleepHours.toFixed(1)}h
                </span>
              )}
            </div>
            {todayLog?.sleepHours ? (
              <SleepBar deep={todayLog.sleepDeep} rem={todayLog.sleepRem} core={todayLog.sleepCore} total={todayLog.sleepHours} />
            ) : <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No sleep data for today</p>}
          </div>

          {/* Recent workouts */}
          {workouts.length > 0 && (
            <div className="card" style={{ border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f59e0b', margin: 0 }}>🏅 Recent Workouts</p>
                <button onClick={() => setTab('workouts')} style={{ fontSize: '0.72rem', color: '#14b8a6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>See all →</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {workouts.slice(0, 3).map(w => {
                  const info = workoutInfo(w.type)
                  return (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--surface-2)', borderRadius: 10, padding: '0.5rem 0.75rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>{info.icon}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600 }}>{info.name}</p>
                        <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-muted)' }}>{w.date} · {w.duration} min{w.calories ? ` · ${w.calories} kcal` : ''}</p>
                      </div>
                      {w.avgHR && <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700 }}>♥ {w.avgHR}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TRENDS ────────────────────────────────────────────────────────── */}
      {tab === 'trends' && hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[
            { title: '⚖️ Weight (kg)', key: 'weight' as keyof HealthLog, color: '#8b5cf6', type: 'area' },
            { title: '📊 Body Fat %', key: 'bodyFat' as keyof HealthLog, color: '#ec4899', type: 'area' },
            { title: '❤️ Resting Heart Rate (bpm)', key: 'heartRateResting' as keyof HealthLog, color: '#ef4444', type: 'area' },
            { title: '📈 HRV — ms (higher = better recovery)', key: 'hrv' as keyof HealthLog, color: '#f59e0b', type: 'area' },
            { title: '🫁 VO₂ Max', key: 'vo2Max' as keyof HealthLog, color: '#14b8a6', type: 'area' },
            { title: '👟 Daily Steps', key: 'steps' as keyof HealthLog, color: '#10b981', type: 'bar' },
            { title: '🔥 Active Calories', key: 'activeEnergy' as keyof HealthLog, color: '#f97316', type: 'bar' },
            { title: '💤 Sleep (hours)', key: 'sleepHours' as keyof HealthLog, color: '#6366f1', type: 'bar' },
          ].map(({ title, key, color, type }) => {
            const data = chartData(key)
            if (data.length < 2) return null
            const vals = data.map(d => d.value)
            const avg  = vals.reduce((a, b) => a + b, 0) / vals.length
            const unit = key === 'steps' ? '' : key === 'activeEnergy' ? 'kcal' : key === 'sleepHours' ? 'h' : key === 'hrv' ? 'ms' : key === 'heartRateResting' ? 'bpm' : key === 'bodyFat' ? '%' : ''
            return (
              <div key={String(key)} className="card" style={{ border: `1px solid ${color}20` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 700, color, margin: 0 }}>{title}</p>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>30d avg</p>
                    <p style={{ fontSize: '0.85rem', fontWeight: 800, color, margin: 0 }}>{avg.toFixed(1)} {unit}</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  {type === 'bar' ? (
                    <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip content={(p) => <ChartTip {...p} unit={unit} />} />
                      <ReferenceLine y={avg} stroke={color} strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} fillOpacity={0.85} />
                    </BarChart>
                  ) : (
                    <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id={`g${String(key)}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                      <Tooltip content={(p) => <ChartTip {...p} unit={unit} />} />
                      <ReferenceLine y={avg} stroke={color} strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area dataKey="value" stroke={color} strokeWidth={2} fill={`url(#g${String(key)})`} dot={false} activeDot={{ r: 4, fill: color }} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── WORKOUTS ──────────────────────────────────────────────────────── */}
      {tab === 'workouts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {workouts.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🏋️</p>
              <p style={{ fontWeight: 600, marginBottom: '0.3rem' }}>No workouts found</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Import your Apple Health ZIP to see your workout history.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem' }}>
                {[
                  { label: 'Workouts', val: workouts.length, icon: '🏅', color: '#14b8a6' },
                  { label: 'Total Time', val: `${Math.round(totalWorkoutTime / 60)}h ${totalWorkoutTime % 60}m`, icon: '⏱️', color: '#f59e0b' },
                  { label: 'Calories', val: `${Math.round(totalWorkoutCal).toLocaleString()}`, icon: '🔥', color: '#ef4444' },
                ].map(x => (
                  <div key={x.label} style={{ background: 'var(--surface)', border: `1px solid ${x.color}20`, borderRadius: 12, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '0 0 0.2rem' }}>{x.icon} {x.label}</p>
                    <p style={{ fontSize: '1.1rem', fontWeight: 800, color: x.color, margin: 0 }}>{x.val}</p>
                  </div>
                ))}
              </div>

              {/* Type breakdown */}
              <div className="card" style={{ border: '1px solid rgba(20,184,166,0.15)' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem' }}>Breakdown by type</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {Object.entries(workoutTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const info = workoutInfo(type)
                    const pct  = Math.round(count / workouts.length * 100)
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '1.1rem', width: 24, textAlign: 'center' }}>{info.icon}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, width: 110, flexShrink: 0 }}>{info.name}</span>
                        <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 99, height: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: info.color, borderRadius: 99 }} />
                        </div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{count}×</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Workout list */}
              <div className="card" style={{ padding: '0.75rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.65rem 0.25rem' }}>All workouts (last 30 days)</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {workouts.map(w => {
                    const info = workoutInfo(w.type)
                    return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.75rem', background: `${info.color}0a`, borderRadius: 10, border: `1px solid ${info.color}20` }}>
                        <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{info.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: info.color }}>{info.name}</p>
                          <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {w.date} · {Math.round(w.duration)} min
                            {w.distance ? ` · ${w.distance} ${w.distanceUnit ?? 'km'}` : ''}
                            {w.calories ? ` · ${Math.round(w.calories)} kcal` : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {w.avgHR && <p style={{ margin: 0, fontSize: '0.75rem', color: '#ef4444', fontWeight: 700 }}>♥ {w.avgHR} avg</p>}
                          {w.maxHR && <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-muted)' }}>max {w.maxHR}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
