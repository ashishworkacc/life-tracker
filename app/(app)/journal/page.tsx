'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy, limit } from '@/lib/firebase/db'

interface Reflection {
  id: string
  date: string
  win: string
  grateful: string
  intention: string
}

interface ActivityLog {
  id: string
  text: string
  mood: number | null
  activityTag: string | null
  timestamp: string
  date: string
  hour: number
}

const MOOD_EMOJIS = ['😔', '😐', '🙂', '😊', '🚀']
const ACTIVITY_COLORS: Record<string, string> = {
  Morning: '#f59e0b', Eating: '#22c55e', Working: '#3b82f6',
  Exercise: '#ef4444', Commute: '#8b5cf6', Resting: '#6b7280',
  Learning: '#14b8a6', Social: '#ec4899', Home: '#f97316', 'Self-care': '#a78bfa',
}

function formatTime(ts: string) {
  try { return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return '' }
}

function formatDate(dateStr: string) {
  const today = todayDate()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yStr = yesterday.toISOString().split('T')[0]
  if (dateStr === today) return 'Today'
  if (dateStr === yStr) return 'Yesterday'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function JournalPage() {
  const { user } = useAuth()
  const today = todayDate()
  const [tab, setTab] = useState<'reflections' | 'lifelog' | 'summaries'>('reflections')

  // Reflections
  const [reflections, setReflections] = useState<Reflection[]>([])
  const [reflLoading, setReflLoading] = useState(true)
  const [showReflect, setShowReflect] = useState(false)
  const [editingRefl, setEditingRefl] = useState<Reflection | null>(null)
  const [reflDate, setReflDate] = useState(today)
  const [win, setWin] = useState('')
  const [grateful, setGrateful] = useState('')
  const [intention, setIntention] = useState('')
  const [savingRefl, setSavingRefl] = useState(false)

  // Life logs
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [editingLog, setEditingLog] = useState<ActivityLog | null>(null)
  const [logText, setLogText] = useState('')
  const [logMood, setLogMood] = useState<number | null>(null)
  const [savingLog, setSavingLog] = useState(false)

  // Day summaries
  interface DaySummary { id: string; date: string; content: string; source?: string }
  const [summaries, setSummaries] = useState<DaySummary[]>([])
  const [summariesLoading, setSummariesLoading] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [aiDraft, setAiDraft] = useState('')
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null)
  const [editingSummaryText, setEditingSummaryText] = useState('')

  useEffect(() => {
    if (!user) return
    loadReflections()
    loadActivityLogs()
  }, [user])

  useEffect(() => {
    if (!user || tab !== 'summaries') return
    if (summaries.length === 0) loadSummaries()
  }, [tab, user])

  async function loadReflections() {
    if (!user) return
    try {
      const docs = await queryDocuments('daily_reflections', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        limit(30),
      ])
      setReflections(docs.map(d => ({
        id: d.id, date: d.date,
        win: d.win ?? d.winText ?? '',
        grateful: d.grateful ?? d.proudText ?? '',
        intention: d.intention ?? d.intentionText ?? '',
      })))
    } catch (err) {
      console.error('loadReflections error:', err)
    } finally {
      setReflLoading(false)
    }
  }

  async function loadActivityLogs() {
    if (!user) return
    try {
      const docs = await queryDocuments('activity_logs', [
        where('userId', '==', user.uid),
      ])
      const sorted = docs.map(d => ({
        id: d.id, text: d.text ?? '', mood: d.mood ?? null,
        activityTag: d.activityTag ?? null,
        timestamp: typeof d.timestamp === 'string' ? d.timestamp : (d.timestamp?.toDate?.()?.toISOString?.() ?? new Date().toISOString()),
        date: d.date ?? today, hour: d.hour ?? 0,
      })).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      setActivityLogs(sorted)
    } catch (err) {
      console.error('loadActivityLogs error:', err)
    } finally {
      setLogsLoading(false)
    }
  }

  async function loadSummaries() {
    if (!user) return
    setSummariesLoading(true)
    try {
      const docs = await queryDocuments('daily_summaries_ai', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        limit(30),
      ])
      setSummaries(docs.map(d => ({ id: d.id, date: d.date, content: d.content ?? '', source: d.source ?? 'ai' })))
    } catch { /* ignore */ }
    setSummariesLoading(false)
  }

  async function generateDaySummary() {
    if (!user || generatingSummary) return
    setGeneratingSummary(true)
    try {
      // Fetch today's data
      const { queryDocuments: qd, where: w, orderBy: ob } = await import('@/lib/firebase/db')
      const [habitLogs, todos, counters, counterLogs, foodLogs, thoughtLogs, xpEvents] = await Promise.all([
        qd('daily_habit_logs', [w('userId', '==', user.uid), w('date', '==', today), w('completed', '==', true)]),
        qd('todos', [w('userId', '==', user.uid), w('completed', '==', true), w('completedAt', '>=', today)]),
        qd('custom_counters', [w('userId', '==', user.uid)]),
        qd('counter_logs', [w('userId', '==', user.uid), w('date', '==', today)]),
        qd('food_logs', [w('userId', '==', user.uid), w('date', '==', today)]),
        qd('activity_logs', [w('userId', '==', user.uid), w('date', '==', today), w('activityTag', '==', 'thought')]),
        qd('xp_events', [w('userId', '==', user.uid), w('date', '==', today)]),
      ])

      const habitsCompleted = habitLogs.map(l => l.habitId as string)
      const todosCompleted = todos.map(t => t.title as string)
      const xpEarned = xpEvents.reduce((s, e) => s + (e.xpEarned ?? 0), 0)
      const thoughtTexts = thoughtLogs.map(l => l.text as string).filter(Boolean)
      const foodCals = foodLogs.reduce((s, l) => s + (l.calories ?? 0), 0)
      const foodProtein = foodLogs.reduce((s, l) => s + (l.protein ?? 0), 0)

      const counterUpdates = counterLogs.map(cl => {
        const c = (counters as any[]).find(ct => ct.id === cl.counterId)
        return c ? { name: c.name, added: cl.countAdded ?? 0, current: c.currentCount ?? 0, target: c.targetCount ?? 0 } : null
      }).filter(Boolean)

      const res = await fetch('/api/ai/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid, date: today,
          habitsCompleted, todosCompleted, countersUpdated: counterUpdates, xpEarned,
          activityLogs: thoughtTexts,
          foodSummary: foodCals > 0 ? { calories: Math.round(foodCals), protein: Math.round(foodProtein) } : null,
        }),
      })
      const data = await res.json()
      setAiDraft(data.summary ?? '')
    } catch { setAiDraft('Could not generate summary — try again.') }
    setGeneratingSummary(false)
  }

  async function saveDaySummary(content: string) {
    if (!user || !content.trim()) return
    await addDocument('daily_summaries_ai', { userId: user.uid, date: today, content: content.trim(), source: 'ai', editedByUser: content !== aiDraft })
    setSummaries(prev => [{ id: Date.now().toString(), date: today, content: content.trim(), source: 'ai' }, ...prev])
    setAiDraft('')
  }

  async function updateSummary(id: string, content: string) {
    await updateDocument('daily_summaries_ai', id, { content, editedByUser: true })
    setSummaries(prev => prev.map(s => s.id === id ? { ...s, content } : s))
    setEditingSummaryId(null)
    setEditingSummaryText('')
  }

  function openNewReflection() {
    setEditingRefl(null)
    setReflDate(today)
    setWin(''); setGrateful(''); setIntention('')
    setShowReflect(true)
  }

  function openEditReflection(r: Reflection) {
    setEditingRefl(r)
    setReflDate(r.date)
    setWin(r.win); setGrateful(r.grateful); setIntention(r.intention)
    setShowReflect(true)
  }

  async function saveReflection() {
    if (!user || !win.trim()) return
    setSavingRefl(true)
    const data = { userId: user.uid, date: reflDate, win, grateful, intention }
    if (editingRefl) {
      await updateDocument('daily_reflections', editingRefl.id, data)
      setReflections(prev => prev.map(r => r.id === editingRefl.id ? { id: editingRefl.id, ...data } : r))
    } else {
      await addDocument('daily_reflections', data)
      await loadReflections()
    }
    setShowReflect(false)
    setSavingRefl(false)
  }

  async function deleteReflection(id: string) {
    await deleteDocument('daily_reflections', id)
    setReflections(prev => prev.filter(r => r.id !== id))
  }

  function openEditLog(log: ActivityLog) {
    setEditingLog(log)
    setLogText(log.text)
    setLogMood(log.mood)
  }

  async function saveLogEdit() {
    if (!user || !editingLog) return
    setSavingLog(true)
    await updateDocument('activity_logs', editingLog.id, { text: logText, mood: logMood })
    setActivityLogs(prev => prev.map(l => l.id === editingLog.id ? { ...l, text: logText, mood: logMood } : l))
    setEditingLog(null)
    setSavingLog(false)
  }

  async function deleteLog(id: string) {
    await deleteDocument('activity_logs', id)
    setActivityLogs(prev => prev.filter(l => l.id !== id))
  }

  // Group life logs by date
  const groupedLogs: Record<string, ActivityLog[]> = {}
  for (const log of activityLogs) {
    if (!groupedLogs[log.date]) groupedLogs[log.date] = []
    groupedLogs[log.date].push(log)
  }

  // Reflection form view
  if (showReflect) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">✍️ {editingRefl ? 'Edit' : 'New'} Reflection</h3>
            <input type="date" value={reflDate} onChange={e => setReflDate(e.target.value)}
              className="text-xs px-2 py-1 rounded-lg outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: '#22c55e' }}>🏆 Today&apos;s win</label>
              <textarea value={win} onChange={e => setWin(e.target.value)}
                placeholder="What went well today? Big or small." rows={2} autoFocus
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: '#f59e0b' }}>🙏 Grateful for</label>
              <textarea value={grateful} onChange={e => setGrateful(e.target.value)}
                placeholder="What are you thankful for today?" rows={2}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: '#818cf8' }}>🎯 Tomorrow&apos;s intention</label>
              <textarea value={intention} onChange={e => setIntention(e.target.value)}
                placeholder="What do you want to focus on tomorrow?" rows={2}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowReflect(false)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveReflection} disabled={savingRefl || !win.trim()}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>
              {savingRefl ? 'Saving...' : editingRefl ? 'Update' : '✓ Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Edit log view
  if (editingLog) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Edit Life Log</h3>
            <span className="text-xs text-muted">{formatTime(editingLog.timestamp)}</span>
          </div>
          <textarea value={logText} onChange={e => setLogText(e.target.value)} rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div>
            <p className="text-xs text-muted mb-2">Mood</p>
            <div className="flex gap-2">
              {MOOD_EMOJIS.map((e, i) => (
                <button key={i} onClick={() => setLogMood(logMood === i + 1 ? null : i + 1)}
                  className="flex-1 py-2 rounded-xl text-xl"
                  style={{
                    background: logMood === i + 1 ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                    border: logMood === i + 1 ? '2px solid #14b8a6' : '1px solid var(--border)',
                  }}>{e}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditingLog(null)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveLogEdit} disabled={savingLog}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>
              {savingLog ? '...' : 'Update'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      {/* Tab switcher */}
      <div className="flex rounded-xl p-1" style={{ background: 'var(--surface)' }}>
        {(['reflections', 'lifelog', 'summaries'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{ background: tab === t ? '#14b8a6' : 'transparent', color: tab === t ? 'white' : 'var(--muted)' }}>
            {t === 'reflections' ? '✍️ Reflect' : t === 'lifelog' ? '📍 Life Log' : '📋 Summaries'}
          </button>
        ))}
      </div>

      {tab === 'reflections' && (
        <>
          <button onClick={openNewReflection}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #14b8a6, #818cf8)', color: 'white' }}>
            ✍️ Write Today&apos;s Reflection
          </button>

          {reflLoading ? (
            <div className="text-center py-8"><p className="text-sm text-muted">Loading...</p></div>
          ) : reflections.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-4xl mb-3">✍️</p>
              <p className="text-sm text-muted">No reflections yet.</p>
              <p className="text-xs text-muted mt-1">Daily reflection builds clarity and gratitude.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reflections.map(r => (
                <div key={r.id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold" style={{ color: '#14b8a6' }}>
                      📅 {formatDate(r.date)}
                    </p>
                    <div className="flex gap-1">
                      <button onClick={() => openEditReflection(r)}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ color: 'var(--muted)' }}>✏️</button>
                      <button onClick={() => deleteReflection(r.id)}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ color: '#ef4444' }}>🗑️</button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {r.win && (
                      <div>
                        <span className="text-[10px] text-muted uppercase">🏆 Win</span>
                        <p className="text-sm">{r.win}</p>
                      </div>
                    )}
                    {r.grateful && (
                      <div>
                        <span className="text-[10px] text-muted uppercase">🙏 Grateful</span>
                        <p className="text-sm">{r.grateful}</p>
                      </div>
                    )}
                    {r.intention && (
                      <div>
                        <span className="text-[10px] text-muted uppercase">🎯 Tomorrow</span>
                        <p className="text-sm">{r.intention}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'lifelog' && (
        <>
          <p className="text-xs text-muted">
            Your captured moments. Tap + to add. AI uses this to understand your daily patterns.
          </p>
          {logsLoading ? (
            <div className="text-center py-8"><p className="text-sm text-muted">Loading...</p></div>
          ) : activityLogs.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-4xl mb-3">📍</p>
              <p className="text-sm text-muted">No life logs yet. Tap + to log your first moment.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedLogs).map(([date, entries]) => (
                <div key={date}>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#14b8a6' }}>{formatDate(date)}</p>
                  <div className="space-y-2">
                    {entries.map(log => (
                      <div key={log.id} className="flex gap-3 px-3 py-2.5 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                          <span className="text-xs text-muted">{formatTime(log.timestamp)}</span>
                          {log.mood !== null && (
                            <span className="text-base">{MOOD_EMOJIS[(log.mood ?? 1) - 1]}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {log.activityTag && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full mr-1"
                              style={{ background: `${ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6'}20`, color: ACTIVITY_COLORS[log.activityTag] ?? '#14b8a6' }}>
                              {log.activityTag}
                            </span>
                          )}
                          {log.text && <p className="text-sm mt-0.5">{log.text}</p>}
                          {!log.text && !log.activityTag && <p className="text-sm text-muted italic">Mood logged</p>}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button onClick={() => openEditLog(log)}
                            className="text-[10px] px-1.5 py-1 rounded"
                            style={{ color: 'var(--muted)' }}>✏️</button>
                          <button onClick={() => deleteLog(log.id)}
                            className="text-[10px] px-1.5 py-1 rounded"
                            style={{ color: '#ef4444' }}>🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Day Summaries Tab ─── */}
      {tab === 'summaries' && (
        <div className="space-y-4">
          {/* Generate today's summary */}
          <div className="card space-y-3" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
            <h3 className="font-semibold text-sm">📋 Today&apos;s Day Summary</h3>
            <p className="text-xs text-muted">AI generates a summary from your habits, todos, counters, and notes. You can edit before saving.</p>
            {!aiDraft ? (
              <button onClick={generateDaySummary} disabled={generatingSummary}
                className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #14b8a6, #818cf8)', color: 'white' }}>
                {generatingSummary ? (
                  <><span className="animate-spin">⏳</span> Generating…</>
                ) : '✨ Generate Today\'s Summary'}
              </button>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={aiDraft}
                  onChange={e => setAiDraft(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                <div className="flex gap-2">
                  <button onClick={() => setAiDraft('')}
                    className="flex-1 py-2 rounded-xl text-xs"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Discard</button>
                  <button onClick={() => saveDaySummary(aiDraft)}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: '#14b8a6', color: 'white' }}>Save Summary</button>
                </div>
              </div>
            )}
          </div>

          {/* History */}
          {summariesLoading ? (
            <div className="text-center py-6"><p className="text-sm text-muted">Loading…</p></div>
          ) : summaries.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-3xl">📋</p>
              <p className="text-sm font-medium">No summaries yet</p>
              <p className="text-xs text-muted">Generate your first daily summary above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-muted uppercase">History ({summaries.length})</h3>
              {summaries.map(s => (
                <div key={s.id} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold" style={{ color: '#14b8a6' }}>📅 {formatDate(s.date)}</p>
                    <button onClick={() => { setEditingSummaryId(s.id); setEditingSummaryText(s.content) }}
                      className="text-xs px-2 py-1 rounded-lg"
                      style={{ color: 'var(--muted)' }}>✏️</button>
                  </div>
                  {editingSummaryId === s.id ? (
                    <div className="space-y-2">
                      <textarea value={editingSummaryText} onChange={e => setEditingSummaryText(e.target.value)}
                        rows={4} className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingSummaryId(null); setEditingSummaryText('') }}
                          className="flex-1 py-1.5 rounded-lg text-xs"
                          style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
                        <button onClick={() => updateSummary(s.id, editingSummaryText)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: '#14b8a6', color: 'white' }}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed">{s.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
