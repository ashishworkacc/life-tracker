'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, addDocument, updateDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

const STATIC_TRACKERS = [
  { href: '/trackers/sleep',       icon: '😴', label: 'Sleep',        desc: 'Bedtime & wake time',    color: '#818cf8' },
  { href: '/trackers/weight',      icon: '⚖️', label: 'Weight',       desc: 'Daily weight log',       color: '#f59e0b' },
  { href: '/trackers/food',        icon: '🍽️', label: 'Food Log',     desc: 'Meals, macros & calories', color: '#22c55e' },
  { href: '/trackers/screen-time', icon: '📱', label: 'Screen Time',  desc: 'Daily phone usage',      color: '#ef4444' },
  { href: '/trackers/books',       icon: '📚', label: 'Books',        desc: 'Reading tracker',        color: '#14b8a6' },
  { href: '/trackers/vitals',      icon: '💊', label: 'Medications',  desc: 'Meds checklist',         color: '#a855f7' },
]

interface CustomTracker {
  id: string
  name: string
  emoji: string
  color: string
  unit: string
  targetValue?: number
}

interface QuickLogState {
  trackerId: string
  trackerName: string
  unit: string
  todayValue: number | null
  logId: string | null
}

export default function TrackersPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [customTrackers, setCustomTrackers] = useState<CustomTracker[]>([])
  const [todayValues, setTodayValues] = useState<Record<string, { value: number; logId: string }>>({})
  const [quickLog, setQuickLog] = useState<QuickLogState | null>(null)
  const [logValue, setLogValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    loadCustomTrackers()
  }, [user])

  async function loadCustomTrackers() {
    if (!user) return
    try {
      const docs = await queryDocuments('custom_trackers', [
        where('userId', '==', user.uid),
        orderBy('createdAt', 'asc'),
      ])
      const trackers = docs.map(d => ({
        id: d.id, name: d.name, emoji: d.emoji ?? '📊',
        color: d.color ?? '#14b8a6', unit: d.unit ?? 'times',
        targetValue: d.targetValue ?? null,
      }))
      setCustomTrackers(trackers)

      if (trackers.length > 0) {
        const logDocs = await queryDocuments('custom_logs', [
          where('userId', '==', user.uid),
          where('date', '==', today),
        ])
        const vals: Record<string, { value: number; logId: string }> = {}
        for (const l of logDocs) {
          vals[l.trackerId] = { value: l.value ?? 0, logId: l.id }
        }
        setTodayValues(vals)
      }
    } catch { /* ignore */ }
  }

  function openQuickLog(tracker: CustomTracker) {
    const existing = todayValues[tracker.id]
    setQuickLog({
      trackerId: tracker.id,
      trackerName: tracker.name,
      unit: tracker.unit,
      todayValue: existing?.value ?? null,
      logId: existing?.logId ?? null,
    })
    setLogValue(existing ? String(existing.value) : '')
  }

  async function saveQuickLog() {
    if (!user || !quickLog || !logValue.trim()) return
    setSaving(true)
    const val = parseFloat(logValue)
    if (isNaN(val)) { setSaving(false); return }

    if (quickLog.logId) {
      await updateDocument('custom_logs', quickLog.logId, { value: val })
    } else {
      const doc = await addDocument('custom_logs', {
        userId: user.uid, trackerId: quickLog.trackerId,
        date: today, value: val,
      })
      setTodayValues(prev => ({
        ...prev,
        [quickLog.trackerId]: { value: val, logId: doc.id },
      }))
    }

    setTodayValues(prev => ({
      ...prev,
      [quickLog.trackerId]: { value: val, logId: quickLog.logId ?? '' },
    }))
    setSaving(false)
    setQuickLog(null)
  }

  return (
    <div className="pb-4 space-y-5 animate-fade-in">
      <p className="text-sm text-muted">Track your daily data across all areas of life.</p>

      {/* ── Static trackers grid ── */}
      <div className="grid grid-cols-2 gap-3">
        {STATIC_TRACKERS.map(t => (
          <Link key={t.href} href={t.href}
            className="card flex flex-col items-center text-center gap-2 py-5 transition-opacity active:opacity-70">
            <span className="text-4xl">{t.icon}</span>
            <span className="font-semibold text-sm">{t.label}</span>
            <span className="text-xs text-muted">{t.desc}</span>
          </Link>
        ))}
      </div>

      {/* ── Custom trackers ── */}
      {customTrackers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">📊 My Custom Trackers</h3>
            <Link href="/trackers/custom" className="text-xs" style={{ color: '#14b8a6' }}>Manage →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {customTrackers.map(t => {
              const logged = todayValues[t.id]
              const pct = t.targetValue && logged
                ? Math.min((logged.value / t.targetValue) * 100, 100) : null
              return (
                <button key={t.id} onClick={() => openQuickLog(t)}
                  className="card flex flex-col items-start gap-2 py-4 px-4 text-left transition-opacity active:opacity-70">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-3xl">{t.emoji}</span>
                    {logged ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${t.color}20`, color: t.color }}>
                        {logged.value} {t.unit}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
                        + Log
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-sm leading-tight">{t.name}</span>
                  {pct !== null && (
                    <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: pct >= 100 ? '#22c55e' : t.color }} />
                    </div>
                  )}
                  {!logged && (
                    <span className="text-[10px] text-muted">Tap to log today</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Add custom tracker CTA ── */}
      <Link href="/trackers/custom"
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium"
        style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
        <span className="text-lg">+</span>
        {customTrackers.length === 0 ? 'Create a custom tracker' : 'Add another custom tracker'}
      </Link>

      {/* ── Quick log modal ── */}
      {quickLog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setQuickLog(null) }}>
          <div className="w-full max-w-lg rounded-2xl p-5 space-y-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Log: {quickLog.trackerName}</h3>
              <button onClick={() => setQuickLog(null)} style={{ color: 'var(--muted)' }}>✕</button>
            </div>
            {quickLog.todayValue !== null && (
              <p className="text-sm text-muted">Today so far: <strong>{quickLog.todayValue} {quickLog.unit}</strong></p>
            )}
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={logValue}
                onChange={e => setLogValue(e.target.value)}
                placeholder={`Enter value (${quickLog.unit})`}
                autoFocus
                className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                onKeyDown={e => e.key === 'Enter' && saveQuickLog()}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setQuickLog(null)}
                className="flex-1 py-3 rounded-xl text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
              <button onClick={saveQuickLog} disabled={!logValue.trim() || saving}
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: '#14b8a6', color: 'white' }}>
                {saving ? 'Saving...' : quickLog.todayValue !== null ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
