'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'

interface Insight {
  id: string
  date: string
  summary: string
  generatedAt: string
}

export default function AIInsightsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    loadInsights()
  }, [user])

  async function loadInsights() {
    if (!user) return
    const docs = await queryDocuments('daily_insights', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(10),
    ])
    setInsights(docs.map(d => ({
      id: d.id,
      date: d.date,
      summary: d.summary,
      generatedAt: d.generatedAt,
    })))
    setLoading(false)
  }

  async function generateInsight() {
    if (!user) return
    setGenerating(true)
    try {
      // Fetch last 7 days of daily summaries
      const summaries = await queryDocuments('daily_summaries', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        limit(7),
      ])

      if (summaries.length < 3) {
        alert('Log at least 3 days of data first to get a meaningful insight.')
        setGenerating(false)
        return
      }

      const avgSleep = summaries.reduce((s, d) => s + (d.hoursSlept ?? 0), 0) / summaries.length
      const habitPct = summaries.reduce((s, d) => s + (d.habitsDone / Math.max(d.habitsTotal, 1)), 0) / summaries.length * 100
      const avgEnergy = summaries.reduce((s, d) => s + (d.energyLevel ?? 3), 0) / summaries.length
      const screenTimeAvg = summaries.reduce((s, d) => s + (d.phoneMinutes ?? 0), 0) / summaries.length

      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'daily',
          data: {
            days: summaries.length,
            avgSleep: Math.round(avgSleep * 10) / 10,
            habitCompletionPct: Math.round(habitPct),
            weightTrend: 'stable',
            screenTimeAvg: Math.round(screenTimeAvg),
            pagesRead: summaries.reduce((s, d) => s + (d.pagesRead ?? 0), 0),
            energyAvg: Math.round(avgEnergy * 10) / 10,
            correlations: [],
          }
        })
      })

      const { insight } = await res.json()

      // Save to Firestore
      const { addDocument } = await import('@/lib/firebase/db')
      await addDocument('daily_insights', {
        userId: user.uid,
        date: today,
        summary: insight,
        generatedAt: new Date().toISOString(),
      })

      await loadInsights()
    } catch (err) {
      console.error('Generate insight error:', err)
    }
    setGenerating(false)
  }

  async function getSnapshot() {
    if (!user) return
    setSnapshotLoading(true)
    try {
      const summaries = await queryDocuments('daily_summaries', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        limit(7),
      ])

      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'snapshot',
          data: {
            recentDays: summaries.slice(0, 7),
            message: 'Give me an honest 4-sentence life snapshot based on this data.',
          }
        })
      })
      const { insight } = await res.json()
      setSnapshot(insight)
    } catch (err) {
      console.error('Snapshot error:', err)
    }
    setSnapshotLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading insights...</p></div>
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Generate new insight */}
      <div className="card" style={{ border: '1px solid rgba(20,184,166,0.3)' }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🤖</span>
          <div>
            <p className="font-semibold text-sm">AI Daily Insight</p>
            <p className="text-xs text-muted">Powered by DeepSeek V3 via OpenRouter</p>
          </div>
        </div>
        <button onClick={generateInsight} disabled={generating}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50 mb-2"
          style={{ background: '#14b8a6', color: 'white' }}>
          {generating ? '🤔 Analysing your data...' : '✨ Generate today\'s insight'}
        </button>
        <button onClick={getSnapshot} disabled={snapshotLoading}
          className="w-full py-2.5 rounded-xl text-sm disabled:opacity-50"
          style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          {snapshotLoading ? '🤔 Thinking...' : '🪞 How am I doing right now?'}
        </button>
      </div>

      {/* Snapshot result */}
      {snapshot && (
        <div className="card" style={{ border: '1px solid rgba(99,102,241,0.3)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span>🪞</span>
            <span className="font-semibold text-sm">Life Snapshot</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>{snapshot}</p>
          <button onClick={() => setSnapshot(null)} className="text-xs text-muted mt-2">Dismiss</button>
        </div>
      )}

      {/* Insights list */}
      {insights.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">🤖</p>
          <p className="text-sm text-muted mb-2">No insights yet.</p>
          <p className="text-xs text-muted">Log 3+ days of data, then generate your first AI insight above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {insights.map(insight => (
            <div key={insight.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold" style={{ color: '#14b8a6' }}>
                  {new Date(insight.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <span className="text-xs text-muted">🤖 AI</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
                {insight.summary}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
