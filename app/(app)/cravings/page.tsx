'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, todayDate, where, orderBy } from '@/lib/firebase/db'
import type { DocumentData } from 'firebase/firestore'

export default function CravingsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [badHabitName, setBadHabitName] = useState('')
  const [badHabitCue, setBadHabitCue] = useState('')
  const [badHabitTrigger, setBadHabitTrigger] = useState('')
  const [badHabitThoughts, setBadHabitThoughts] = useState('')
  const [badHabitIntensity, setBadHabitIntensity] = useState(3)
  const [badHabitLogs, setBadHabitLogs] = useState<DocumentData[]>([])
  const [savingBadHabit, setSavingBadHabit] = useState(false)
  const [badHabitAiAnalysis, setBadHabitAiAnalysis] = useState('')
  const [badHabitAiLoading, setBadHabitAiLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadLogs()
  }, [user])

  async function loadLogs() {
    if (!user) return
    setLoading(true)
    try {
      const docs = await queryDocuments('bad_habit_logs', [
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
      ])
      setBadHabitLogs(docs)
    } catch { /* ignore */ }
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
      trigger: badHabitTrigger.trim(),
      thoughts: badHabitThoughts.trim(),
      intensity: badHabitIntensity,
    }
    await addDocument('bad_habit_logs', doc)
    setBadHabitLogs(prev => [{ id: Date.now().toString(), ...doc }, ...prev])
    setBadHabitName('')
    setBadHabitCue('')
    setBadHabitTrigger('')
    setBadHabitThoughts('')
    setBadHabitIntensity(3)
    setSavingBadHabit(false)
  }

  async function analyzeBadHabits() {
    if (!user || badHabitLogs.length === 0) return
    setBadHabitAiLoading(true)
    try {
      const sample = badHabitLogs.slice(0, 20).map(l => ({
        name: l.badHabitName, cue: l.cue, trigger: l.trigger, thoughts: l.thoughts, intensity: l.intensity, date: l.date,
      }))
      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'bad-habits',
          userId: user.uid,
          data: `Analyze these ${sample.length} bad habit log entries. Identify: 1) the top 2 recurring triggers or cues, 2) a pattern in timing or thoughts, 3) one concrete replacement habit or coping strategy. Be direct and specific — reference actual entries.\n\nData: ${JSON.stringify(sample)}`,
        }),
      })
      const resData = await res.json()
      setBadHabitAiAnalysis(resData.insight ?? '')
    } catch { setBadHabitAiAnalysis('Could not generate analysis — try again.') }
    setBadHabitAiLoading(false)
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>⚠️ Cravings & Patterns</h1>
        <p className="text-xs text-muted mt-0.5">Track urges and slips as they happen — patterns will surface over time.</p>
      </div>

      {/* Log form */}
      <div className="card space-y-3" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
        <h3 className="font-semibold text-sm" style={{ color: '#ef4444' }}>📝 Log a Craving or Slip</h3>
        <p className="text-xs text-muted">Record what triggered it while it&apos;s fresh — this is how patterns surface.</p>

        <div>
          <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">What happened? (bad habit or craving)</p>
          <input
            type="text"
            value={badHabitName}
            onChange={e => setBadHabitName(e.target.value)}
            placeholder="e.g. Doomscrolled for an hour, Ate junk food…"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <input type="text" value={badHabitCue} onChange={e => setBadHabitCue(e.target.value)}
            placeholder="Cue / situation (e.g. 'Bored at 11pm')"
            className="w-full px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="text" value={badHabitTrigger} onChange={e => setBadHabitTrigger(e.target.value)}
            placeholder="Trigger / what caused it (e.g. 'Stressed about work')"
            className="w-full px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <textarea value={badHabitThoughts} onChange={e => setBadHabitThoughts(e.target.value)}
            placeholder="Thoughts at the time…"
            rows={2}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
        </div>

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

        <button onClick={saveBadHabit} disabled={!badHabitName.trim() || savingBadHabit}
          className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
          style={{ background: '#ef4444', color: 'white' }}>
          {savingBadHabit ? 'Saving…' : 'Log it'}
        </button>
      </div>

      {/* AI Analysis */}
      {badHabitLogs.length >= 3 && (
        <div className="card space-y-2" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">🧠 What triggers me?</h3>
            <button onClick={analyzeBadHabits} disabled={badHabitAiLoading}
              className="text-[10px] px-2.5 py-1 rounded-lg disabled:opacity-40"
              style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
              {badHabitAiLoading ? '⏳' : 'Analyse'}
            </button>
          </div>
          {badHabitAiAnalysis && (
            <p className="text-sm leading-relaxed">{badHabitAiAnalysis}</p>
          )}
          {!badHabitAiAnalysis && !badHabitAiLoading && (
            <p className="text-xs text-muted">Tap Analyse to find patterns in your {badHabitLogs.length} entries.</p>
          )}
        </div>
      )}

      {/* Past logs */}
      {loading ? (
        <div className="text-center py-8"><p className="text-sm text-muted">Loading…</p></div>
      ) : badHabitLogs.length > 0 ? (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">📋 Recent entries ({badHabitLogs.length})</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {badHabitLogs.slice(0, 30).map((log, i) => (
              <div key={log.id ?? i} className="px-3 py-2.5 rounded-xl space-y-1"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: '#ef4444' }}>{log.badHabitName}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted">{log.date}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                      {log.intensity}/5
                    </span>
                  </div>
                </div>
                {log.cue && <p className="text-xs text-muted">📍 {log.cue}</p>}
                {log.trigger && <p className="text-xs text-muted">⚡ {log.trigger}</p>}
                {log.thoughts && <p className="text-xs text-muted italic">&ldquo;{log.thoughts}&rdquo;</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 space-y-2">
          <p className="text-3xl">🧘</p>
          <p className="text-sm font-medium">No entries yet</p>
          <p className="text-xs text-muted">Log cravings or slips above — patterns will emerge.</p>
        </div>
      )}
    </div>
  )
}
