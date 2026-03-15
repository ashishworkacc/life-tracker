'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface WeightLog {
  id: string
  date: string
  weight: number
}

export default function WeightTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [logDate, setLogDate] = useState(today)
  const [weight, setWeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logs, setLogs] = useState<WeightLog[]>([])
  const [targetWeight, setTargetWeight] = useState<number | null>(null)
  const [editingLog, setEditingLog] = useState<WeightLog | null>(null)
  const [editWeight, setEditWeight] = useState('')

  useEffect(() => {
    if (!user) return
    loadLogs()
  }, [user])

  async function loadLogs() {
    if (!user) return
    const docs = await queryDocuments('weight_logs', [
      where('userId', '==', user.uid),
      orderBy('date', 'asc'),
      limit(90),
    ])
    const mapped = docs.map(d => ({ id: d.id, date: d.date, weight: d.weight }))
    setLogs(mapped)
    if (mapped.length > 0) {
      const todayLog = mapped.find(d => d.date === today)
      if (todayLog) setWeight(String(todayLog.weight))
    }

    // Try to get target from goals
    const goals = await queryDocuments('goals', [
      where('userId', '==', user.uid),
      where('category', '==', 'health'),
    ])
    const weightGoal = goals.find(g => g.title?.toLowerCase().includes('weight'))
    if (weightGoal?.targetValue) setTargetWeight(weightGoal.targetValue)
  }

  async function handleSave() {
    if (!user || !weight || !logDate) return
    setSaving(true)
    // Check if entry for this date already exists
    const existing = logs.find(l => l.date === logDate)
    if (existing) {
      await updateDocument('weight_logs', existing.id, { weight: parseFloat(weight) })
    } else {
      await addDocument('weight_logs', {
        userId: user.uid, date: logDate, weight: parseFloat(weight),
      })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await loadLogs()
  }

  async function handleEditSave() {
    if (!editingLog || !editWeight) return
    await updateDocument('weight_logs', editingLog.id, { weight: parseFloat(editWeight) })
    setEditingLog(null)
    setEditWeight('')
    await loadLogs()
  }

  async function handleDelete(log: WeightLog) {
    await deleteDocument('weight_logs', log.id)
    setLogs(prev => prev.filter(l => l.id !== log.id))
    if (log.date === today) setWeight('')
  }

  const latestWeight = logs.length ? logs[logs.length - 1].weight : null
  const firstWeight = logs.length ? logs[0].weight : null
  const totalChange = latestWeight && firstWeight ? Math.round((latestWeight - firstWeight) * 10) / 10 : null

  const chartData = logs.map(l => ({
    date: new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    weight: l.weight,
  }))

  const minWeight = logs.length ? Math.floor(Math.min(...logs.map(l => l.weight)) - 1) : 0
  const maxWeight = logs.length ? Math.ceil(Math.max(...logs.map(l => l.weight)) + 1) : 100

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{latestWeight ?? '—'}</p>
          <p className="text-xs text-muted">Current (kg)</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold"
            style={{ color: totalChange === null ? 'var(--muted)' : totalChange < 0 ? '#22c55e' : '#ef4444' }}>
            {totalChange !== null ? (totalChange > 0 ? '+' : '') + totalChange : '—'}
          </p>
          <p className="text-xs text-muted">Total change (kg)</p>
        </div>
        {targetWeight && (
          <div className="flex-1 card-sm text-center">
            <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>
              {latestWeight ? Math.round(Math.abs(latestWeight - targetWeight) * 10) / 10 : '—'}
            </p>
            <p className="text-xs text-muted">To goal (kg)</p>
          </div>
        )}
      </div>

      {/* Log form */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Log Weight</h3>
        <div className="flex gap-2 mb-3">
          <input
            type="date"
            value={logDate}
            onChange={e => {
              setLogDate(e.target.value)
              const existing = logs.find(l => l.date === e.target.value)
              if (existing) setWeight(String(existing.weight))
              else setWeight('')
            }}
            className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
          <input
            type="number"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            placeholder="e.g. 72.5"
            step="0.1"
            className="w-28 px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
          <span className="flex items-center text-sm text-muted">kg</span>
        </div>
        <button onClick={handleSave} disabled={saving || !weight || !logDate}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white' }}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : logs.find(l => l.date === logDate) ? 'Update weight' : 'Log weight'}
        </button>
      </div>

      {/* 90-day trend */}
      {chartData.length > 1 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Weight Trend</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false}
                interval={Math.ceil(chartData.length / 5)} />
              <YAxis domain={[minWeight, maxWeight]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              {targetWeight && <ReferenceLine y={targetWeight} stroke="#14b8a6" strokeDasharray="4 2" />}
              <Tooltip formatter={(val: any) => [`${val} kg`, 'Weight']}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
              <Line type="monotone" dataKey="weight" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
          {targetWeight && (
            <p className="text-xs text-muted text-center mt-1">Teal line = target ({targetWeight} kg)</p>
          )}
        </div>
      )}

      {/* Recent logs with edit/delete */}
      {logs.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Recent Logs</h3>
          <div className="space-y-2">
            {[...logs].reverse().slice(0, 14).map((l, i) => {
              const prev = [...logs].reverse()[i + 1]
              const diff = prev ? Math.round((l.weight - prev.weight) * 10) / 10 : null

              if (editingLog?.id === l.id) {
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <span className="text-xs text-muted w-24 flex-shrink-0">
                      {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <input type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                      step="0.1" autoFocus
                      className="w-20 px-2 py-1 rounded-lg text-sm outline-none"
                      style={{ background: 'var(--surface-2)', border: '1px solid #14b8a6', color: 'var(--foreground)' }} />
                    <span className="text-xs text-muted">kg</span>
                    <button onClick={handleEditSave}
                      className="px-2 py-1 rounded-lg text-xs font-semibold"
                      style={{ background: '#14b8a6', color: 'white' }}>✓</button>
                    <button onClick={() => { setEditingLog(null); setEditWeight('') }}
                      className="px-2 py-1 rounded-lg text-xs"
                      style={{ color: 'var(--muted)' }}>✕</button>
                  </div>
                )
              }

              return (
                <div key={l.date} className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted">
                    {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex items-center gap-2">
                    {diff !== null && (
                      <span className="text-xs" style={{ color: diff < 0 ? '#22c55e' : diff > 0 ? '#ef4444' : 'var(--muted)' }}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                    <span className="text-sm font-semibold">{l.weight} kg</span>
                    <button onClick={() => { setEditingLog(l); setEditWeight(String(l.weight)) }}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ color: '#14b8a6' }}>✏️</button>
                    <button onClick={() => handleDelete(l)}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ color: '#ef4444' }}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
