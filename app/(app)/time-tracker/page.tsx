'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface TimeEntry {
  id: string
  category: string
  description: string
  durationMins: number
  startTime?: string
  endTime?: string
  isRunning?: boolean
  date: string
}

const CATEGORIES = ['work', 'learning', 'exercise', 'personal', 'side-project']
const CATEGORY_COLORS: Record<string, string> = {
  work: '#818cf8',
  learning: '#14b8a6',
  exercise: '#22c55e',
  personal: '#f59e0b',
  'side-project': '#a855f7',
}
const CATEGORY_ICONS: Record<string, string> = {
  work: '💼',
  learning: '📚',
  exercise: '🏃',
  personal: '👤',
  'side-project': '🚀',
}

export default function TimeTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // New entry form
  const [showAdd, setShowAdd] = useState(false)
  const [newCategory, setNewCategory] = useState('work')
  const [newDesc, setNewDesc] = useState('')
  const [newMins, setNewMins] = useState('')

  useEffect(() => {
    if (!user) return
    loadEntries()
  }, [user])

  useEffect(() => {
    if (activeEntry) {
      const startMs = new Date(activeEntry.startTime ?? '').getTime()
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startMs) / 1000))
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [activeEntry])

  async function loadEntries() {
    if (!user) return
    const docs = await queryDocuments('time_entries', [
      where('userId', '==', user.uid),
      where('date', '==', today),
      orderBy('startTime', 'desc'),
    ])
    const active = docs.find(d => d.isRunning)
    if (active) {
      setActiveEntry({
        id: active.id,
        category: active.category,
        description: active.description,
        durationMins: active.durationMins ?? 0,
        startTime: active.startTime,
        isRunning: true,
        date: active.date,
      })
    }
    setEntries(docs.filter(d => !d.isRunning).map(d => ({
      id: d.id,
      category: d.category,
      description: d.description,
      durationMins: d.durationMins ?? 0,
      startTime: d.startTime,
      endTime: d.endTime,
      date: d.date,
    })))
    setLoading(false)
  }

  async function startTimer() {
    if (!user || !newDesc.trim()) return
    const startTime = new Date().toISOString()
    const doc = await addDocument('time_entries', {
      userId: user.uid,
      date: today,
      category: newCategory,
      description: newDesc.trim(),
      startTime,
      isRunning: true,
      durationMins: 0,
    })
    setActiveEntry({ id: doc.id, category: newCategory, description: newDesc.trim(), durationMins: 0, startTime, isRunning: true, date: today })
    setNewDesc('')
    setShowAdd(false)
    setElapsed(0)
  }

  async function stopTimer() {
    if (!user || !activeEntry) return
    const endTime = new Date().toISOString()
    const durationMins = Math.round(elapsed / 60)
    await updateDocument('time_entries', activeEntry.id, {
      endTime, isRunning: false, durationMins,
    })
    setActiveEntry(null)
    setElapsed(0)
    await loadEntries()
  }

  async function deleteEntry(id: string) {
    await deleteDocument('time_entries', id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function logManual() {
    if (!user || !newDesc.trim() || !newMins) return
    await addDocument('time_entries', {
      userId: user.uid,
      date: today,
      category: newCategory,
      description: newDesc.trim(),
      durationMins: parseInt(newMins),
    })
    setNewDesc('')
    setNewMins('')
    setShowAdd(false)
    await loadEntries()
  }

  // Pie chart data
  const categoryTotals: Record<string, number> = {}
  for (const e of entries) {
    categoryTotals[e.category] = (categoryTotals[e.category] ?? 0) + e.durationMins
  }
  const pieData = Object.entries(categoryTotals).map(([cat, mins]) => ({
    name: cat, value: mins, color: CATEGORY_COLORS[cat] ?? '#6b7280'
  }))

  const totalMins = entries.reduce((s, e) => s + e.durationMins, 0)

  function fmtElapsed(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Active timer */}
      {activeEntry ? (
        <div className="card text-center" style={{ border: '1px solid rgba(20,184,166,0.4)' }}>
          <p className="text-xs text-muted uppercase font-semibold mb-1">
            {CATEGORY_ICONS[activeEntry.category]} {activeEntry.category} · Running
          </p>
          <p className="text-sm font-medium mb-2">{activeEntry.description}</p>
          <p className="text-5xl font-mono font-bold mb-3" style={{ color: '#14b8a6' }}>
            {fmtElapsed(elapsed)}
          </p>
          <button onClick={stopTimer}
            className="w-full py-3 rounded-xl font-semibold text-sm"
            style={{ background: '#ef4444', color: 'white' }}>
            ⏹ Stop
          </button>
        </div>
      ) : (
        <>
          {/* Today total */}
          <div className="flex gap-3">
            <div className="flex-1 card-sm text-center">
              <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>
                {Math.floor(totalMins / 60)}h {totalMins % 60}m
              </p>
              <p className="text-xs text-muted">Today</p>
            </div>
            <div className="flex-1 card-sm text-center">
              <p className="text-2xl font-bold">{entries.length}</p>
              <p className="text-xs text-muted">Sessions</p>
            </div>
          </div>

          {/* Add / Start */}
          {showAdd ? (
            <div className="card space-y-3">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setNewCategory(c)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize"
                    style={{
                      background: newCategory === c ? CATEGORY_COLORS[c] + '20' : 'var(--surface-2)',
                      border: `1px solid ${newCategory === c ? CATEGORY_COLORS[c] : 'var(--border)'}`,
                      color: newCategory === c ? CATEGORY_COLORS[c] : 'var(--muted)',
                    }}>
                    {CATEGORY_ICONS[c]} {c}
                  </button>
                ))}
              </div>
              <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="What are you working on?"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                autoFocus />
              <div className="flex gap-2">
                <button onClick={startTimer} disabled={!newDesc.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#14b8a6', color: 'white' }}>
                  ▶ Start timer
                </button>
                <div className="flex gap-1">
                  <input type="number" value={newMins} onChange={e => setNewMins(e.target.value)}
                    placeholder="mins" className="w-16 px-2 py-2.5 rounded-xl text-sm outline-none text-center"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                  <button onClick={logManual} disabled={!newDesc.trim() || !newMins}
                    className="px-3 py-2.5 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    Log
                  </button>
                </div>
              </div>
              <button onClick={() => setShowAdd(false)} className="w-full text-xs text-muted py-1">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)}
              className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
              <span className="text-lg">+</span> Track time
            </button>
          )}
        </>
      )}

      {/* Pie chart */}
      {pieData.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Today&apos;s Breakdown</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                dataKey="value" paddingAngle={2}>
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip formatter={(val: any) => [`${Math.floor(val / 60)}h ${val % 60}m`, '']}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                <span className="text-xs capitalize">{CATEGORY_ICONS[d.name]} {d.name}</span>
                <span className="text-xs text-muted">{Math.floor(d.value / 60)}h {d.value % 60}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entries list */}
      {entries.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Sessions</h3>
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-3">
                <span className="text-lg">{CATEGORY_ICONS[e.category] ?? '⏱️'}</span>
                <div className="flex-1">
                  <p className="text-sm">{e.description}</p>
                  <p className="text-xs text-muted capitalize">{e.category}</p>
                </div>
                <span className="text-sm font-medium mr-2">
                  {Math.floor(e.durationMins / 60) > 0 ? `${Math.floor(e.durationMins / 60)}h ` : ''}{e.durationMins % 60}m
                </span>
                <button onClick={() => deleteEntry(e.id)}
                  className="text-xs px-1.5 py-1 rounded flex-shrink-0" style={{ color: '#ef4444' }}>🗑️</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
