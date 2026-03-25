'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, todayDate, where, orderBy } from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'


const BREATHING_STEPS = [
  { label: 'Breathe IN', duration: 4, color: '#14b8a6' },
  { label: 'Hold', duration: 4, color: '#f59e0b' },
  { label: 'Breathe OUT', duration: 6, color: '#8b5cf6' },
  { label: 'Hold', duration: 2, color: '#6b7280' },
]

export default function CravingsPage() {
  const { user } = useAuth()
  const today = todayDate()

  // Form state
  const [badHabitName, setBadHabitName] = useState('')
  const [badHabitCue, setBadHabitCue] = useState('')
  const [badHabitThoughts, setBadHabitThoughts] = useState('')
  const [badHabitIntensity, setBadHabitIntensity] = useState(3)
  const [haltText, setHaltText] = useState('')
  const [didResist, setDidResist] = useState<boolean | null>(null)

  // Data state
  const [badHabitLogs, setBadHabitLogs] = useState<DocumentData[]>([])
  const [savingBadHabit, setSavingBadHabit] = useState(false)
  const [badHabitAiAnalysis, setBadHabitAiAnalysis] = useState('')
  const [badHabitAiLoading, setBadHabitAiLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeTab, setActiveTab] = useState<'log' | 'history' | 'patterns'>('log')

  // Urge surfing state
  const [urgeSurfing, setUrgeSurfing] = useState(false)
  const [urgeTimer, setUrgeTimer] = useState(600) // 10 min in seconds
  const [breathStep, setBreathStep] = useState(0)
  const [breathTimer, setBreathTimer] = useState(BREATHING_STEPS[0].duration)
  const urgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const breathIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!user) return
    loadLogs()
  }, [user])

  // Breathing cycle
  useEffect(() => {
    if (!urgeSurfing) {
      if (breathIntervalRef.current) clearInterval(breathIntervalRef.current)
      return
    }
    breathIntervalRef.current = setInterval(() => {
      setBreathTimer(prev => {
        if (prev <= 1) {
          setBreathStep(s => (s + 1) % BREATHING_STEPS.length)
          return BREATHING_STEPS[(breathStep + 1) % BREATHING_STEPS.length].duration
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (breathIntervalRef.current) clearInterval(breathIntervalRef.current) }
  }, [urgeSurfing, breathStep])

  // 10-min urge countdown
  useEffect(() => {
    if (!urgeSurfing) {
      if (urgeIntervalRef.current) clearInterval(urgeIntervalRef.current)
      return
    }
    urgeIntervalRef.current = setInterval(() => {
      setUrgeTimer(prev => {
        if (prev <= 1) { setUrgeSurfing(false); return 600 }
        return prev - 1
      })
    }, 1000)
    return () => { if (urgeIntervalRef.current) clearInterval(urgeIntervalRef.current) }
  }, [urgeSurfing])

  function startUrgeSurf() {
    setUrgeSurfing(true)
    setUrgeTimer(600)
    setBreathStep(0)
    setBreathTimer(BREATHING_STEPS[0].duration)
  }
  function stopUrgeSurf() {
    setUrgeSurfing(false)
    setUrgeTimer(600)
  }

  async function loadLogs() {
    if (!user) return
    setLoading(true)
    setLoadError('')
    try {
      // Try ordered query first
      const docs = await queryDocuments('bad_habit_logs', [
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
      ])
      setBadHabitLogs(docs)
    } catch {
      // Fallback: unordered (works without composite index)
      try {
        const docs = await queryDocuments('bad_habit_logs', [
          where('userId', '==', user.uid),
        ])
        // Sort client-side
        docs.sort((a: DocumentData, b: DocumentData) =>
          (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
        setBadHabitLogs(docs)
      } catch (e2) {
        setLoadError('Could not load logs — check your connection.')
        console.error(e2)
      }
    }
    setLoading(false)
  }

  async function saveBadHabit() {
    if (!user || !badHabitName.trim()) return
    setSavingBadHabit(true)
    const doc = {
      userId: user.uid,
      date: today,
      timestamp: new Date().toISOString(),
      badHabitName: badHabitName.trim(),
      cue: badHabitCue.trim(),
      thoughts: badHabitThoughts.trim(),
      intensity: badHabitIntensity,
      halt: haltText,
      didResist: didResist ?? false,
    }
    try {
      const saved = await addDocument('bad_habit_logs', doc)
      const newEntry = { id: saved?.id ?? Date.now().toString(), ...doc }
      setBadHabitLogs(prev => [newEntry, ...prev])
      // Reset form
      setBadHabitName('')
      setBadHabitCue('')
      setBadHabitThoughts('')
      setBadHabitIntensity(3)
      setHaltText('')
      setDidResist(null)
      setActiveTab('history')
    } catch (e) {
      console.error('Failed to save craving log:', e)
    }
    setSavingBadHabit(false)
  }

  async function analyzeWithAtomicHabits() {
    if (!user || badHabitLogs.length === 0) return
    setBadHabitAiLoading(true)
    try {
      const sample = badHabitLogs.slice(0, 30).map(l => ({
        name: l.badHabitName,
        cue: l.cue,
        thoughts: l.thoughts,
        intensity: l.intensity,
        halt: l.halt,
        didResist: l.didResist,
        date: l.date,
        timestamp: l.timestamp,
      }))

      // Count HALT flags
      const haltCounts = { hungry: 0, angry: 0, lonely: 0, tired: 0 }
      badHabitLogs.forEach(l => {
        if (l.halt?.hungry) haltCounts.hungry++
        if (l.halt?.angry) haltCounts.angry++
        if (l.halt?.lonely) haltCounts.lonely++
        if (l.halt?.tired) haltCounts.tired++
      })

      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'bad-habits',
          userId: user.uid,
          data: `You are an Atomic Habits coach by James Clear. Analyze these ${sample.length} craving/slip entries using the Atomic Habits framework (Cue → Craving → Response → Reward loop).

HALT state counts across all entries:
- Hungry: ${haltCounts.hungry}/${badHabitLogs.length} times
- Angry/Stressed: ${haltCounts.angry}/${badHabitLogs.length} times
- Lonely: ${haltCounts.lonely}/${badHabitLogs.length} times
- Tired: ${haltCounts.tired}/${badHabitLogs.length} times

Resistance rate: ${badHabitLogs.filter(l => l.didResist).length}/${badHabitLogs.length} times the urge was resisted.

Entries: ${JSON.stringify(sample)}

Provide:
1. **The Habit Loop**: Identify the primary Cue → Craving → Response → Reward cycle
2. **Top Trigger**: The #1 environmental/emotional trigger (reference actual entries)
3. **Identity Shift**: One identity statement to adopt (e.g. "I am someone who...")
4. **Implementation Intention**: One specific "When X happens, I will do Y instead" plan
5. **Predictive Pattern**: Based on HALT data, when are they most vulnerable?

Be direct, specific, and actionable. Reference actual data. No fluff.`,
        }),
      })
      const resData = await res.json()
      setBadHabitAiAnalysis(resData.insight ?? '')
    } catch {
      setBadHabitAiAnalysis('Could not generate analysis — try again.')
    }
    setBadHabitAiLoading(false)
  }

  // Group logs by habit name for pattern view
  const habitGroups = badHabitLogs.reduce((acc: Record<string, DocumentData[]>, log) => {
    const key = log.badHabitName ?? 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(log)
    return acc
  }, {})

  const topHalt = Object.entries(
    badHabitLogs.reduce((acc: Record<string, number>, l) => {
      if (l.halt?.hungry) acc.Hungry = (acc.Hungry ?? 0) + 1
      if (l.halt?.angry) acc.Angry = (acc.Angry ?? 0) + 1
      if (l.halt?.lonely) acc.Lonely = (acc.Lonely ?? 0) + 1
      if (l.halt?.tired) acc.Tired = (acc.Tired ?? 0) + 1
      return acc
    }, {})
  ).sort(([, a], [, b]) => b - a)

  const resistRate = badHabitLogs.length > 0
    ? Math.round((badHabitLogs.filter(l => l.didResist).length / badHabitLogs.length) * 100)
    : 0

  const currentBreath = BREATHING_STEPS[breathStep]
  const mins = Math.floor(urgeTimer / 60)
  const secs = urgeTimer % 60

  return (
    <div className="pb-4 space-y-4 animate-fade-in" style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 className="text-xl font-bold">⚠️ Cravings & Patterns</h1>
          <p className="text-xs text-muted mt-0.5">Track urges using the Atomic Habits method — patterns surface automatically.</p>
        </div>
        {badHabitLogs.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
            <span style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '3px 10px', borderRadius: 99, fontWeight: 600 }}>
              {badHabitLogs.length} logged
            </span>
            <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '3px 10px', borderRadius: 99, fontWeight: 600 }}>
              {resistRate}% resisted
            </span>
          </div>
        )}
      </div>

      {/* 🆘 URGE SURF BUTTON */}
      {!urgeSurfing ? (
        <button
          onClick={startUrgeSurf}
          style={{
            width: '100%', padding: '1rem', borderRadius: 16,
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            border: 'none', color: '#fff', fontWeight: 700, fontSize: '1rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
          }}
        >
          🆘 Help! I'm having a craving right now
          <span style={{ fontSize: '0.75rem', opacity: 0.85, fontWeight: 400 }}>→ 10-min urge surf</span>
        </button>
      ) : (
        <div style={{
          borderRadius: 16, overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.1))',
          border: '1px solid rgba(124,58,237,0.3)', padding: '1.5rem', textAlign: 'center',
        }}>
          {/* Countdown */}
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#7c3aed', letterSpacing: '-1px', lineHeight: 1 }}>
            {mins}:{secs.toString().padStart(2, '0')}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 1.25rem' }}>
            Urges typically peak &amp; pass in 10 minutes. Breathe through it.
          </p>

          {/* Breathing circle */}
          <div style={{ position: 'relative', margin: '0 auto 1rem', width: 120, height: 120 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: `${currentBreath.color}20`,
              border: `3px solid ${currentBreath.color}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.5s ease',
              animation: currentBreath.label.includes('IN') ? 'pulse 4s ease-in-out' : 'none',
            }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: currentBreath.color }}>{breathTimer}</span>
              <span style={{ fontSize: '0.7rem', color: currentBreath.color, fontWeight: 600 }}>{currentBreath.label}</span>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            4-4-6-2 box breathing • {BREATHING_STEPS.map(s => s.label).join(' → ')}
          </p>

          <button onClick={stopUrgeSurf} style={{
            background: 'none', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 8,
            color: '#7c3aed', padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.82rem',
          }}>
            I'm calm — stop timer
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--surface)', borderRadius: 10, padding: '3px' }}>
        {(['log', 'history', 'patterns'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            flex: 1, padding: '0.45rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
            background: activeTab === t ? 'var(--color-primary)' : 'transparent',
            color: activeTab === t ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}>
            {t === 'log' ? '📝 Log' : t === 'history' ? `📋 History (${badHabitLogs.length})` : '🔬 Patterns'}
          </button>
        ))}
      </div>

      {/* ─── LOG TAB ─── */}
      {activeTab === 'log' && (
        <div className="card space-y-4" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">What happened?</p>
            <input
              type="text"
              value={badHabitName}
              onChange={e => setBadHabitName(e.target.value)}
              placeholder="e.g. Doomscrolled 1 hour, Ordered Zomato, Smoked…"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* HALT */}
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">HALT Check — what were you feeling?</p>
            <textarea
              value={haltText}
              onChange={e => setHaltText(e.target.value)}
              placeholder="Describe what you were feeling (hungry, stressed, bored, lonely, tired, anxious...)"
              rows={3}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)', lineHeight: 1.6 }}
            />
          </div>

          {/* Cue */}
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">Cue / Situation (the trigger environment)</p>
            <input
              type="text"
              value={badHabitCue}
              onChange={e => setBadHabitCue(e.target.value)}
              placeholder="e.g. Sitting alone at 11pm, just finished stressful work…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {/* Deep thoughts */}
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">What were you thinking / feeling? (be honest)</p>
            <textarea
              value={badHabitThoughts}
              onChange={e => setBadHabitThoughts(e.target.value)}
              placeholder="What were you telling yourself? What reward were you seeking? What emotion were you trying to escape?&#10;&#10;The more honest you are here, the better the AI can help you break the loop."
              rows={5}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)', lineHeight: 1.6 }}
            />
          </div>

          {/* Intensity */}
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">Intensity</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setBadHabitIntensity(n)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                  style={{
                    background: badHabitIntensity === n ? 'rgba(239,68,68,0.15)' : 'var(--surface-2)',
                    border: badHabitIntensity === n ? '1px solid #ef4444' : '1px solid var(--border)',
                    color: badHabitIntensity === n ? '#ef4444' : 'var(--muted)',
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted">Mild urge</span>
              <span className="text-[9px] text-muted">Gave in fully</span>
            </div>
          </div>

          {/* Did you resist? */}
          <div>
            <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">Did you resist?</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[true, false].map(val => (
                <button key={String(val)} onClick={() => setDidResist(val)} style={{
                  flex: 1, padding: '0.5rem', borderRadius: 10, border: `1px solid ${didResist === val ? (val ? '#10b981' : '#ef4444') : 'var(--border)'}`,
                  background: didResist === val ? (val ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)') : 'var(--surface-2)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
                  color: didResist === val ? (val ? '#10b981' : '#ef4444') : 'var(--text-muted)',
                }}>
                  {val ? '✅ Yes, resisted' : '❌ No, gave in'}
                </button>
              ))}
            </div>
          </div>

          <button onClick={saveBadHabit} disabled={!badHabitName.trim() || savingBadHabit}
            className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: '#ef4444', color: 'white' }}>
            {savingBadHabit ? 'Saving…' : 'Log this entry'}
          </button>
        </div>
      )}

      {/* ─── HISTORY TAB ─── */}
      {activeTab === 'history' && (
        <div className="card">
          {loadError && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#ef4444' }}>
              {loadError} <button onClick={loadLogs} style={{ marginLeft: '0.5rem', textDecoration: 'underline', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8"><p className="text-sm text-muted">Loading your logs…</p></div>
          ) : badHabitLogs.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-3xl">🧘</p>
              <p className="text-sm font-medium">No entries yet</p>
              <p className="text-xs text-muted">Switch to Log tab to record your first craving.</p>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-sm mb-3">📋 All entries ({badHabitLogs.length})</h3>
              <div className="space-y-2" style={{ maxHeight: 520, overflowY: 'auto' }}>
                {badHabitLogs.map((log, i) => (
                  <div key={log.id ?? i} className="px-3 py-2.5 rounded-xl space-y-1.5"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <span className="text-sm font-semibold" style={{ color: log.didResist ? '#10b981' : '#ef4444' }}>
                        {log.didResist ? '✅' : '❌'} {log.badHabitName}
                      </span>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span className="text-[10px] text-muted">{log.date}</span>
                        <span style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 99, fontSize: '0.68rem', padding: '1px 7px', fontWeight: 700 }}>
                          {log.intensity}/5
                        </span>
                      </div>
                    </div>
                    {/* HALT */}
                    {log.halt && typeof log.halt === 'string' && (
                      <p className="text-xs text-muted">🧠 {log.halt}</p>
                    )}
                    {log.halt && typeof log.halt === 'object' && Object.values(log.halt as Record<string, boolean>).some(Boolean) && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {Object.entries(log.halt as Record<string, boolean>)
                          .filter(([, v]) => v)
                          .map(([k]) => (
                            <span key={k} style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', borderRadius: 99, fontSize: '0.68rem', padding: '1px 7px' }}>
                              {k}
                            </span>
                          ))}
                      </div>
                    )}
                    {log.cue && <p className="text-xs text-muted">📍 {log.cue}</p>}
                    {log.thoughts && <p className="text-xs text-muted italic" style={{ lineHeight: 1.5 }}>&ldquo;{log.thoughts}&rdquo;</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── PATTERNS TAB ─── */}
      {activeTab === 'patterns' && (
        <div className="space-y-4">
          {/* Stats row */}
          {badHabitLogs.length >= 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ef4444' }}>{badHabitLogs.length}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total logged</div>
              </div>
              <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>{resistRate}%</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Resisted</div>
              </div>
              <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>
                  {(badHabitLogs.reduce((s, l) => s + (l.intensity ?? 3), 0) / badHabitLogs.length).toFixed(1)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Avg intensity</div>
              </div>
            </div>
          )}

          {/* HALT breakdown */}
          {topHalt.length > 0 && (
            <div className="card" style={{ border: '1px solid rgba(239,68,68,0.15)' }}>
              <h3 className="font-semibold text-sm mb-3">🔴 Your HALT triggers</h3>
              <div className="space-y-2">
                {topHalt.map(([label, count]) => {
                  const pct = Math.round((count / badHabitLogs.length) * 100)
                  return (
                    <div key={label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.8rem' }}>{label}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#ef4444' }}>{count}x ({pct}%)</span>
                      </div>
                      <div style={{ height: 5, background: 'var(--border)', borderRadius: 99 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#ef4444', borderRadius: 99 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Habit frequency */}
          {Object.keys(habitGroups).length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-sm mb-3">📊 Frequency by habit</h3>
              <div className="space-y-2">
                {Object.entries(habitGroups)
                  .sort(([, a], [, b]) => b.length - a.length)
                  .map(([name, entries]) => {
                    const pct = Math.round((entries.length / badHabitLogs.length) * 100)
                    const avgIntensity = (entries.reduce((s, l) => s + (l.intensity ?? 3), 0) / entries.length).toFixed(1)
                    return (
                      <div key={name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{name}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entries.length}x · avg {avgIntensity}/5</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--border)', borderRadius: 99 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 99 }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          <div className="card" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div>
                <h3 className="font-semibold text-sm">🧠 Atomic Habits Analysis</h3>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Cue → Craving → Response → Reward loop analysis
                </p>
              </div>
              <button onClick={analyzeWithAtomicHabits}
                disabled={badHabitAiLoading || badHabitLogs.length < 3}
                style={{
                  background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
                  color: '#a855f7', borderRadius: 8, padding: '0.4rem 0.85rem',
                  fontSize: '0.78rem', fontWeight: 600, cursor: badHabitLogs.length < 3 ? 'not-allowed' : 'pointer',
                  opacity: badHabitLogs.length < 3 ? 0.5 : 1,
                }}>
                {badHabitAiLoading ? '⏳ Analysing…' : '✨ Analyse'}
              </button>
            </div>
            {badHabitLogs.length < 3 && (
              <p className="text-xs text-muted">Log at least 3 entries to unlock pattern analysis.</p>
            )}
            {badHabitAiAnalysis && (
              <div style={{ fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--foreground)' }}>
                {badHabitAiAnalysis}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
