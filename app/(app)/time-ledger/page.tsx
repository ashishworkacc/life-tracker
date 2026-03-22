'use client'

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { setDocument, queryDocuments, where } from '@/lib/firebase/db'

// ─── Types ───────────────────────────────────────────────────────────────────
type Classification = 'high-yield' | 'maintenance' | 'mediocre' | null

interface Block {
  entry: string
  classification: Classification
  note?: string
}

interface DayData {
  blocks: Record<string, Block>
  mediocreScore: number | null
  status: 'on-fire' | 'solid' | 'mediocre' | null
  verdict?: string
  analyzedAt?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SLOTS: string[] = []
for (let h = 0; h < 24; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

const CLASS_META = {
  'high-yield':  { label: 'High Yield',  color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: '🔥' },
  'maintenance': { label: 'Maintenance', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚙️' },
  'mediocre':    { label: 'Mediocre',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '💀' },
} as const

function dateStr(d: Date) { return d.toISOString().split('T')[0] }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function isCurrentSlot(slot: string) {
  const now = new Date(), h = now.getHours(), m = now.getMinutes()
  const [sh, sm] = slot.split(':').map(Number)
  const slotMin = sh * 60 + sm, nowMin = h * 60 + m
  return nowMin >= slotMin && nowMin < slotMin + 30
}
function isPastSlot(slot: string) {
  const now = new Date()
  const [sh, sm] = slot.split(':').map(Number)
  return now.getHours() * 60 + now.getMinutes() > sh * 60 + sm
}

// ─── SlotRow — defined OUTSIDE parent so its identity is stable ───────────────
interface SlotRowProps {
  slot: string
  block: Block | undefined
  ghost: string | undefined
  isActive: boolean
  isToday: boolean
  isPast: boolean
  isSaving: boolean
  onActivate: (slot: string) => void
  onDeactivate: () => void
  onUpdate: (slot: string, entry: string) => void
}

const SlotRow = memo(function SlotRow({
  slot, block, ghost, isActive, isToday, isPast, isSaving,
  onActivate, onDeactivate, onUpdate,
}: SlotRowProps) {
  const entry = block?.entry ?? ''
  const cls   = block?.classification ?? null
  const isCurrent = isToday && isCurrentSlot(slot)
  const meta  = cls ? CLASS_META[cls] : null

  // Local textarea state — prevents cursor-reset on parent re-renders
  const [localValue, setLocalValue] = useState(entry)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Sync external entry changes into local state (e.g. after AI analysis)
  useEffect(() => {
    if (!isActiveRef.current) setLocalValue(entry)
  }, [entry])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setLocalValue(val)
    onUpdate(slot, val)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
      padding: '0.3rem 0.5rem', borderRadius: 8, transition: 'background 0.2s',
      background: isCurrent ? 'rgba(20,184,166,0.08)' : cls ? meta!.bg : 'transparent',
      border: isCurrent ? '1px solid rgba(20,184,166,0.3)' : '1px solid transparent',
    }}>
      {/* Time label */}
      <div style={{
        width: 40, flexShrink: 0, paddingTop: '0.4rem',
        fontSize: '0.65rem', fontFamily: 'monospace',
        color: isCurrent ? '#14b8a6' : 'var(--text-muted)',
        fontWeight: isCurrent ? 800 : 500,
      }}>
        {slot}
        {isCurrent && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#14b8a6', marginTop: 2 }} />}
      </div>

      {/* Input */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isActive ? (
          <textarea
            autoFocus
            value={localValue}
            onChange={handleChange}
            onBlur={() => { onUpdate(slot, localValue); onDeactivate() }}
            placeholder={ghost ? `Typically: ${ghost}` : 'What did you do here?'}
            rows={2}
            style={{
              width: '100%', padding: '0.4rem 0.6rem', borderRadius: 8, fontSize: '0.78rem',
              border: `1px solid ${meta?.color ?? '#14b8a6'}`,
              background: 'var(--surface-2)', color: 'var(--text-primary)',
              resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            onClick={() => onActivate(slot)}
            style={{
              minHeight: 28, padding: '0.35rem 0.5rem', borderRadius: 8, cursor: 'text',
              fontSize: '0.78rem',
              color: entry ? (meta?.color ?? 'var(--text-primary)') : 'var(--text-muted)',
              fontStyle: entry ? 'normal' : 'italic',
            }}
          >
            {entry || (ghost
              ? <span style={{ opacity: 0.35 }}>Typically: {ghost}</span>
              : isPast ? <span style={{ opacity: 0.25 }}>— backfill this block</span> : null
            )}
          </div>
        )}
      </div>

      {/* Classification badge */}
      {cls && (
        <div style={{ flexShrink: 0, paddingTop: '0.35rem', fontSize: '0.65rem', fontWeight: 700, color: meta!.color }}>
          {meta!.icon}
        </div>
      )}
      {isSaving && (
        <div style={{ flexShrink: 0, paddingTop: '0.4rem', fontSize: '0.6rem', color: 'var(--text-muted)' }}>…</div>
      )}
    </div>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────
export default function TimeLedgerPage() {
  const { user } = useAuth()
  const todayStr = dateStr(new Date())

  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [days, setDays]       = useState<Record<string, DayData>>({})
  const [ghostMap, setGhostMap] = useState<Record<string, string>>({})
  const [analyzing, setAnalyzing] = useState(false)
  const [activeSlot, setActiveSlot] = useState<string | null>(null)
  const [saving, setSaving]   = useState<string | null>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const daysRef = useRef(days)
  daysRef.current = days

  const isToday = selectedDate === todayStr

  useEffect(() => { if (user) loadData() }, [user])

  async function loadData() {
    if (!user) return
    const cutoff = dateStr(addDays(new Date(), -14))
    const docs = await queryDocuments('time_ledger', [where('userId', '==', user.uid)])
    const loaded: Record<string, DayData> = {}
    const slotFreq: Record<string, Record<string, number>> = {}

    for (const doc of docs) {
      if (!doc.date) continue
      loaded[doc.date as string] = {
        blocks: (doc.blocks as Record<string, Block>) ?? {},
        mediocreScore: doc.mediocreScore ?? null,
        status: doc.status ?? null,
        verdict: doc.verdict,
        analyzedAt: doc.analyzedAt,
      }
      if (doc.date < todayStr && doc.date >= cutoff) {
        const blocks = (doc.blocks as Record<string, Block>) ?? {}
        for (const [slot, block] of Object.entries(blocks)) {
          if (!block.entry?.trim()) continue
          if (!slotFreq[slot]) slotFreq[slot] = {}
          const key = block.entry.trim().toLowerCase()
          slotFreq[slot][key] = (slotFreq[slot][key] ?? 0) + 1
        }
      }
    }

    const ghost: Record<string, string> = {}
    for (const [slot, freq] of Object.entries(slotFreq)) {
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
      if (top && top[1] >= 2) ghost[slot] = top[0]
    }

    setDays(loaded)
    setGhostMap(ghost)
  }

  // Stable callbacks passed to SlotRow — won't cause remount
  const handleActivate = useCallback((slot: string) => setActiveSlot(slot), [])
  const handleDeactivate = useCallback(() => setActiveSlot(null), [])

  const handleUpdate = useCallback((slot: string, entry: string) => {
    if (!user) return

    // Update local state immediately (no remount — SlotRow manages its own display)
    setDays(prev => {
      const cur = prev[selectedDate]?.blocks ?? {}
      return {
        ...prev,
        [selectedDate]: {
          ...prev[selectedDate],
          blocks: {
            ...cur,
            [slot]: {
              entry,
              classification: cur[slot]?.classification ?? null,
              note: cur[slot]?.note,
            },
          },
        },
      }
    })

    // Debounced Firestore save
    clearTimeout(saveTimers.current[slot])
    saveTimers.current[slot] = setTimeout(async () => {
      if (!entry.trim()) return
      setSaving(slot)
      const daySnap = daysRef.current[selectedDate]
      const curBlocks = daySnap?.blocks ?? {}
      const updatedBlocks = {
        ...curBlocks,
        [slot]: { entry, classification: curBlocks[slot]?.classification ?? null, note: curBlocks[slot]?.note },
      }
      const docId = `${user.uid}_${selectedDate}`
      await setDocument('time_ledger', docId, {
        userId: user.uid, date: selectedDate,
        blocks: updatedBlocks,
        mediocreScore: daySnap?.mediocreScore ?? null,
        status: daySnap?.status ?? null,
        verdict: daySnap?.verdict ?? null,
        analyzedAt: daySnap?.analyzedAt ?? null,
      })
      setSaving(null)
    }, 1000)
  }, [user, selectedDate])

  async function analyzeDay() {
    if (!user) return
    const dayData = days[selectedDate]
    const filled = Object.entries(dayData?.blocks ?? {})
      .filter(([, b]) => b.entry?.trim())
      .map(([slot, b]) => ({ slot, entry: b.entry }))
    if (filled.length < 3) { alert('Fill in at least 3 time blocks before analyzing.'); return }

    setAnalyzing(true)
    try {
      const res = await fetch('/api/ai/time-ledger-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: filled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const updatedBlocks = { ...(dayData?.blocks ?? {}) }
      for (const r of data.results ?? []) {
        if (updatedBlocks[r.slot]) {
          updatedBlocks[r.slot] = { ...updatedBlocks[r.slot], classification: r.classification, note: r.note }
        }
      }
      const docId = `${user.uid}_${selectedDate}`
      await setDocument('time_ledger', docId, {
        userId: user.uid, date: selectedDate, blocks: updatedBlocks,
        mediocreScore: data.mediocreScore ?? null, status: data.status ?? null,
        verdict: data.verdict ?? null, analyzedAt: new Date().toISOString(),
      })
      setDays(prev => ({
        ...prev,
        [selectedDate]: { blocks: updatedBlocks, mediocreScore: data.mediocreScore, status: data.status, verdict: data.verdict, analyzedAt: new Date().toISOString() },
      }))
    } catch (e: any) { alert('Analysis failed: ' + e.message) }
    setAnalyzing(false)
  }

  const dayData: DayData = days[selectedDate] ?? { blocks: {}, mediocreScore: null, status: null }
  const allBlocks = Object.values(dayData.blocks ?? {}).filter(b => b.entry?.trim())
  const analyzed  = allBlocks.filter(b => b.classification)
  const highYield = analyzed.filter(b => b.classification === 'high-yield').length
  const mainten   = analyzed.filter(b => b.classification === 'maintenance').length
  const mediocre  = analyzed.filter(b => b.classification === 'mediocre').length

  const statusMeta = dayData.status === 'on-fire'
    ? { label: '🔥 ON FIRE', color: '#10b981', bg: 'rgba(16,185,129,0.1)' }
    : dayData.status === 'mediocre'
    ? { label: '💀 MEDIOCRE STATE', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' }
    : dayData.status === 'solid'
    ? { label: '✅ SOLID DAY', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }
    : null

  const amSlots = SLOTS.filter(s => parseInt(s) < 12)
  const pmSlots = SLOTS.filter(s => parseInt(s) >= 12)

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '1rem 1rem 8rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>🕐 Time Ledger</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            48 blocks · 30 min each · {allBlocks.length} filled · {analyzed.length} analyzed
          </p>
        </div>
        <button onClick={analyzeDay} disabled={analyzing || allBlocks.length < 3} style={{
          background: analyzing ? 'var(--surface-2)' : '#6366f1',
          color: analyzing ? 'var(--text-muted)' : '#fff',
          border: 'none', borderRadius: 8, padding: '0.5rem 1rem',
          fontWeight: 700, fontSize: '0.8rem', cursor: analyzing ? 'wait' : 'pointer',
        }}>
          {analyzing ? '🤖 Analyzing…' : '🤖 AI Analyze Day'}
        </button>
      </div>

      {/* Date navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setSelectedDate(dateStr(addDays(new Date(selectedDate), -1)))}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.75rem', cursor: 'pointer', fontWeight: 700 }}>←</button>
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
          style={{ flex: 1, padding: '0.4rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        <button onClick={() => setSelectedDate(dateStr(addDays(new Date(selectedDate), 1)))}
          disabled={selectedDate >= todayStr}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.75rem', cursor: selectedDate >= todayStr ? 'default' : 'pointer', opacity: selectedDate >= todayStr ? 0.4 : 1, fontWeight: 700 }}>→</button>
        {selectedDate !== todayStr && (
          <button onClick={() => setSelectedDate(todayStr)}
            style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 8, padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.78rem', color: '#14b8a6', fontWeight: 700 }}>Today</button>
        )}
      </div>

      {/* Status card */}
      {statusMeta && (
        <div style={{ background: statusMeta.bg, border: `1px solid ${statusMeta.color}30`, borderRadius: 12, padding: '0.75rem 1rem', marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: dayData.verdict ? '0.4rem' : 0 }}>
            <span style={{ fontWeight: 800, color: statusMeta.color, fontSize: '0.9rem' }}>{statusMeta.label}</span>
            {dayData.mediocreScore !== null && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Mediocre: <strong style={{ color: dayData.mediocreScore > 40 ? '#ef4444' : '#10b981' }}>{dayData.mediocreScore}%</strong>
              </span>
            )}
          </div>
          {dayData.verdict && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>"{dayData.verdict}"</p>}
        </div>
      )}

      {/* Stats */}
      {analyzed.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.4rem', marginBottom: '0.85rem' }}>
          {[
            { label: '🔥 High Yield', val: highYield, color: '#10b981' },
            { label: '⚙️ Maintenance', val: mainten,  color: '#f59e0b' },
            { label: '💀 Mediocre',   val: mediocre,  color: '#ef4444' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--surface)', border: `1px solid ${s.color}20`, borderRadius: 10, padding: '0.5rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', margin: '0 0 0.15rem' }}>{s.label}</p>
              <p style={{ fontSize: '1.2rem', fontWeight: 800, color: s.color, margin: 0 }}>{s.val}</p>
              <p style={{ fontSize: '0.58rem', color: 'var(--text-muted)', margin: 0 }}>{Math.round(s.val * 0.5 * 10) / 10}h</p>
            </div>
          ))}
        </div>
      )}

      {/* Day progress bar */}
      {isToday && (() => {
        const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes()
        const pct = Math.round((nowMin / 1440) * 100)
        const filled = Math.round((allBlocks.length / 48) * 100)
        return (
          <div style={{ marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <span>Day elapsed: {pct}%</span>
              <span>Blocks filled: {allBlocks.length}/48</span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: 'rgba(99,102,241,0.25)', borderRadius: 99 }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${filled}%`, background: '#14b8a6', borderRadius: 99, opacity: 0.8 }} />
            </div>
          </div>
        )
      })()}

      {/* AM grid */}
      <div className="card" style={{ padding: '0.5rem', marginBottom: '0.5rem' }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.3rem 0.5rem' }}>🌅 AM</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
          {amSlots.map(slot => (
            <SlotRow key={slot} slot={slot}
              block={dayData.blocks?.[slot]}
              ghost={ghostMap[slot]}
              isActive={activeSlot === slot}
              isToday={isToday}
              isPast={isToday ? isPastSlot(slot) : selectedDate < todayStr}
              isSaving={saving === slot}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      </div>

      {/* PM grid */}
      <div className="card" style={{ padding: '0.5rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.3rem 0.5rem' }}>🌙 PM</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
          {pmSlots.map(slot => (
            <SlotRow key={slot} slot={slot}
              block={dayData.blocks?.[slot]}
              ghost={ghostMap[slot]}
              isActive={activeSlot === slot}
              isToday={isToday}
              isPast={isToday ? isPastSlot(slot) : selectedDate < todayStr}
              isSaving={saving === slot}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {Object.entries(CLASS_META).map(([key, m]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: m.color, fontWeight: 600 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
            {m.label}
          </div>
        ))}
      </div>
    </div>
  )
}
