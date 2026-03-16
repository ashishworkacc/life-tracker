'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface CustomTracker {
  id: string
  name: string
  icon: string
  unit: string
  color: string
  description: string
}

interface CustomLog {
  id: string
  trackerId: string
  date: string
  value: number
  notes: string
}

const PRESET_ICONS = ['📨', '💼', '📞', '🤝', '💪', '🏃', '📖', '✍️', '🧘', '💊', '💰', '🚗', '🍎', '💧', '☕', '🎯', '🔥', '⭐', '📊', '🎵']
const PRESET_COLORS = ['#14b8a6', '#f59e0b', '#22c55e', '#ef4444', '#818cf8', '#a855f7', '#ec4899', '#3b82f6', '#f97316', '#6b7280']

export default function CustomTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [trackers, setTrackers] = useState<CustomTracker[]>([])
  const [logs, setLogs] = useState<CustomLog[]>([])
  const [loading, setLoading] = useState(true)

  // Create/edit tracker form
  const [showForm, setShowForm] = useState(false)
  const [editingTracker, setEditingTracker] = useState<CustomTracker | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📊')
  const [unit, setUnit] = useState('')
  const [color, setColor] = useState('#14b8a6')
  const [description, setDescription] = useState('')
  const [savingTracker, setSavingTracker] = useState(false)

  // Log entry per tracker
  const [logValues, setLogValues] = useState<Record<string, string>>({})
  const [logNotes, setLogNotes] = useState<Record<string, string>>({})
  const [savingLog, setSavingLog] = useState<string | null>(null)
  const [savedLog, setSavedLog] = useState<string | null>(null)

  // View logs modal
  const [viewingTracker, setViewingTracker] = useState<CustomTracker | null>(null)
  const [trackerLogs, setTrackerLogs] = useState<CustomLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    loadAll()
  }, [user])

  async function loadAll() {
    if (!user) return
    try {
      const tDocs = await queryDocuments('custom_trackers', [
        where('userId', '==', user.uid),
      ])
      const loaded: CustomTracker[] = tDocs.map(d => ({
        id: d.id, name: d.name, icon: d.icon ?? '📊',
        unit: d.unit ?? '', color: d.color ?? '#14b8a6',
        description: d.description ?? '',
      }))
      setTrackers(loaded)

      // Load today's logs for all trackers
      const lDocs = await queryDocuments('custom_logs', [
        where('userId', '==', user.uid),
        where('date', '==', today),
      ])
      setLogs(lDocs.map(d => ({
        id: d.id, trackerId: d.trackerId, date: d.date,
        value: d.value ?? 0, notes: d.notes ?? '',
      })))
    } catch (err) {
      console.error('Custom tracker load error:', err)
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingTracker(null)
    setName(''); setIcon('📊'); setUnit(''); setColor('#14b8a6'); setDescription('')
    setShowForm(true)
  }

  function openEdit(t: CustomTracker) {
    setEditingTracker(t)
    setName(t.name); setIcon(t.icon); setUnit(t.unit); setColor(t.color); setDescription(t.description)
    setShowForm(true)
  }

  async function saveTracker() {
    if (!user || !name.trim()) return
    setSavingTracker(true)
    const data = {
      userId: user.uid, name: name.trim(), icon, unit: unit.trim(),
      color, description: description.trim(),
      createdAt: editingTracker ? undefined : new Date().toISOString(),
    }
    if (editingTracker) {
      await updateDocument('custom_trackers', editingTracker.id, data)
      setTrackers(prev => prev.map(t => t.id === editingTracker.id ? { ...t, name: data.name, icon, unit: data.unit, color, description: data.description } : t))
    } else {
      const doc = await addDocument('custom_trackers', data)
      setTrackers(prev => [...prev, { id: (doc as any).id, name: data.name, icon, unit: data.unit, color, description: data.description }])
    }
    setShowForm(false)
    setSavingTracker(false)
  }

  async function deleteTracker(id: string) {
    await deleteDocument('custom_trackers', id)
    setTrackers(prev => prev.filter(t => t.id !== id))
  }

  async function logValue(tracker: CustomTracker) {
    if (!user) return
    const val = parseFloat(logValues[tracker.id] || '0')
    if (!logValues[tracker.id]) return
    setSavingLog(tracker.id)

    const existingLog = logs.find(l => l.trackerId === tracker.id)
    const data = {
      userId: user.uid, trackerId: tracker.id,
      trackerName: tracker.name, date: today,
      value: val, notes: logNotes[tracker.id] ?? '',
    }

    if (existingLog) {
      await updateDocument('custom_logs', existingLog.id, data)
      setLogs(prev => prev.map(l => l.trackerId === tracker.id ? { ...l, value: val, notes: data.notes } : l))
    } else {
      const doc = await addDocument('custom_logs', data)
      setLogs(prev => [...prev, { id: (doc as any).id, trackerId: tracker.id, date: today, value: val, notes: data.notes }])
    }
    setSavingLog(null)
    setSavedLog(tracker.id)
    setTimeout(() => setSavedLog(null), 2000)
  }

  async function openHistory(tracker: CustomTracker) {
    setViewingTracker(tracker)
    setLogsLoading(true)
    try {
      const docs = await queryDocuments('custom_logs', [
        where('userId', '==', user!.uid),
        where('trackerId', '==', tracker.id),
        orderBy('date', 'desc'),
      ])
      setTrackerLogs(docs.map(d => ({
        id: d.id, trackerId: d.trackerId, date: d.date,
        value: d.value ?? 0, notes: d.notes ?? '',
      })))
    } catch (err) {
      console.error('History load error:', err)
    }
    setLogsLoading(false)
  }

  async function deleteLog(logId: string) {
    await deleteDocument('custom_logs', logId)
    setTrackerLogs(prev => prev.filter(l => l.id !== logId))
    setLogs(prev => prev.filter(l => l.id !== logId))
  }

  function formatDate(d: string) {
    if (d === today) return 'Today'
    return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
  }

  // ─── Form view ───
  if (showForm) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="card space-y-4">
          <h3 className="font-semibold text-sm">{editingTracker ? '✏️ Edit Tracker' : '➕ New Custom Tracker'}</h3>

          <div>
            <label className="text-xs text-muted mb-1.5 block">Tracker name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Job Applications, Matrimonial Requests…" autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1.5 block">Unit (what you&apos;re counting)</label>
            <input type="text" value={unit} onChange={e => setUnit(e.target.value)}
              placeholder="e.g. applications, requests, km, pages…"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1.5 block">Description (optional)</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What is this tracker for?"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div>
            <label className="text-xs text-muted mb-2 block">Icon</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_ICONS.map(em => (
                <button key={em} onClick={() => setIcon(em)}
                  className="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all"
                  style={{
                    background: icon === em ? `${color}20` : 'var(--surface-2)',
                    border: icon === em ? `2px solid ${color}` : '1px solid var(--border)',
                  }}>
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted mb-2 block">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-all"
                  style={{
                    background: c,
                    outline: color === c ? `3px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }} />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveTracker} disabled={!name.trim() || savingTracker}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: color, color: 'white' }}>
              {savingTracker ? '...' : editingTracker ? 'Update' : 'Create Tracker'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── History modal ───
  if (viewingTracker) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setViewingTracker(null)}
            className="text-sm px-3 py-1.5 rounded-xl"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>← Back</button>
          <h3 className="font-semibold text-sm">{viewingTracker.icon} {viewingTracker.name} — History</h3>
        </div>

        {logsLoading ? (
          <div className="text-center py-8"><p className="text-sm text-muted">Loading...</p></div>
        ) : trackerLogs.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-4xl mb-2">{viewingTracker.icon}</p>
            <p className="text-sm text-muted">No logs yet.</p>
          </div>
        ) : (
          <div className="card space-y-2">
            {trackerLogs.map(l => (
              <div key={l.id} className="flex items-center justify-between py-2 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-xs text-muted">{formatDate(l.date)}</p>
                  <p className="text-sm font-semibold" style={{ color: viewingTracker.color }}>
                    {l.value} {viewingTracker.unit}
                  </p>
                  {l.notes && <p className="text-xs text-muted">{l.notes}</p>}
                </div>
                <button onClick={() => deleteLog(l.id)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ color: '#ef4444' }}>🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Main view ───
  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Track anything you want — daily.</p>
        <button onClick={openCreate}
          className="text-xs px-3 py-1.5 rounded-xl font-medium"
          style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}>
          + New Tracker
        </button>
      </div>

      {trackers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-5xl mb-3">📊</p>
          <p className="font-semibold mb-1">No custom trackers yet</p>
          <p className="text-sm text-muted mb-5">Track anything — job applications, matrimonial requests, water intake, anything.</p>
          <button onClick={openCreate}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: '#14b8a6', color: 'white' }}>
            Create your first tracker
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {trackers.map(tracker => {
            const todayLog = logs.find(l => l.trackerId === tracker.id)
            const isSaved = savedLog === tracker.id
            const isSaving = savingLog === tracker.id
            return (
              <div key={tracker.id} className="card">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl w-9 h-9 flex items-center justify-center rounded-xl"
                      style={{ background: `${tracker.color}15` }}>
                      {tracker.icon}
                    </span>
                    <div>
                      <p className="font-semibold text-sm">{tracker.name}</p>
                      {tracker.description && <p className="text-xs text-muted">{tracker.description}</p>}
                      {tracker.unit && <p className="text-[10px] text-muted">Unit: {tracker.unit}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openHistory(tracker)}
                      className="text-xs px-1.5 py-1 rounded"
                      style={{ color: tracker.color }}>📈</button>
                    <button onClick={() => openEdit(tracker)}
                      className="text-xs px-1.5 py-1 rounded"
                      style={{ color: 'var(--muted)' }}>✏️</button>
                    <button onClick={() => deleteTracker(tracker.id)}
                      className="text-xs px-1.5 py-1 rounded"
                      style={{ color: '#ef4444' }}>🗑️</button>
                  </div>
                </div>

                {/* Today's log */}
                {todayLog && (
                  <div className="px-3 py-2 rounded-xl mb-3 flex items-center gap-2"
                    style={{ background: `${tracker.color}10`, border: `1px solid ${tracker.color}30` }}>
                    <span className="text-xs font-medium" style={{ color: tracker.color }}>
                      Today: {todayLog.value} {tracker.unit}
                    </span>
                    {todayLog.notes && <span className="text-xs text-muted">· {todayLog.notes}</span>}
                  </div>
                )}

                {/* Log input */}
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={logValues[tracker.id] ?? ''}
                    onChange={e => setLogValues(prev => ({ ...prev, [tracker.id]: e.target.value }))}
                    placeholder={`Enter ${tracker.unit || 'value'}…`}
                    className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                  <input
                    type="text"
                    value={logNotes[tracker.id] ?? ''}
                    onChange={e => setLogNotes(prev => ({ ...prev, [tracker.id]: e.target.value }))}
                    placeholder="Note (optional)"
                    className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  />
                  <button
                    onClick={() => logValue(tracker)}
                    disabled={!logValues[tracker.id] || isSaving}
                    className="px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 flex-shrink-0 transition-all"
                    style={{ background: isSaved ? '#22c55e' : tracker.color, color: 'white', minWidth: '60px' }}>
                    {isSaving ? '…' : isSaved ? '✓' : todayLog ? 'Update' : 'Log'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
