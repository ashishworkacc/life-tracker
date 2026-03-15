'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

interface ScreenTimeLog {
  id: string
  date: string
  minutes: number
}

export default function ScreenTimePage() {
  const { user } = useAuth()
  const today = todayDate()

  const [logDate, setLogDate] = useState(today)
  const [minutes, setMinutes] = useState('')
  const [goalMinutes, setGoalMinutes] = useState('120')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logs, setLogs] = useState<ScreenTimeLog[]>([])
  const [editingLog, setEditingLog] = useState<ScreenTimeLog | null>(null)
  const [editMinutes, setEditMinutes] = useState('')

  useEffect(() => {
    if (!user) return
    loadLogs()
  }, [user])

  async function loadLogs() {
    if (!user) return
    const docs = await queryDocuments('screen_time_logs', [
      where('userId', '==', user.uid),
      orderBy('date', 'asc'),
      limit(14),
    ])
    const mapped = docs.map(d => ({ id: d.id, date: d.date, minutes: d.minutesUsed ?? 0 }))
    setLogs(mapped)
    const todayLog = mapped.find(d => d.date === today)
    if (todayLog) setMinutes(String(todayLog.minutes))
  }

  async function handleSave() {
    if (!user || !minutes || !logDate) return
    setSaving(true)
    const mins = parseInt(minutes)
    const loggedAfter10pm = new Date().getHours() >= 22
    // Check if entry for this date already exists
    const existing = logs.find(l => l.date === logDate)
    if (existing) {
      await updateDocument('screen_time_logs', existing.id, {
        minutesUsed: mins, goal: parseInt(goalMinutes), loggedAfter10pm,
      })
    } else {
      await addDocument('screen_time_logs', {
        userId: user.uid, date: logDate, minutesUsed: mins,
        goal: parseInt(goalMinutes), loggedAfter10pm,
      })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await loadLogs()
  }

  async function handleEditSave() {
    if (!editingLog || !editMinutes) return
    await updateDocument('screen_time_logs', editingLog.id, { minutesUsed: parseInt(editMinutes) })
    setEditingLog(null)
    setEditMinutes('')
    await loadLogs()
  }

  async function handleDelete(log: ScreenTimeLog) {
    await deleteDocument('screen_time_logs', log.id)
    setLogs(prev => prev.filter(l => l.id !== log.id))
    if (log.date === logDate) setMinutes('')
  }

  const mins = parseInt(minutes) || 0
  const goal = parseInt(goalMinutes) || 120
  const pct = Math.min((mins / goal) * 100, 100)
  const overGoal = mins > goal

  const avgMins = logs.length ? Math.round(logs.reduce((s, l) => s + l.minutes, 0) / logs.length) : 0

  const chartData = logs.map(l => ({
    day: new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2),
    minutes: l.minutes,
  }))

  function fmtMins(m: number) {
    const h = Math.floor(m / 60)
    const min = m % 60
    return h > 0 ? `${h}h ${min}m` : `${min}m`
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: overGoal ? '#ef4444' : '#22c55e' }}>{fmtMins(mins || 0)}</p>
          <p className="text-xs text-muted">Today</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{fmtMins(avgMins)}</p>
          <p className="text-xs text-muted">14-day avg</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{fmtMins(goal)}</p>
          <p className="text-xs text-muted">Daily goal</p>
        </div>
      </div>

      {/* Progress ring area */}
      {mins > 0 && (
        <div className="card">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted">Today</span>
                <span style={{ color: overGoal ? '#ef4444' : '#22c55e' }}>
                  {Math.round(pct)}% of goal
                </span>
              </div>
              <div className="w-full rounded-full h-3 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: overGoal ? '#ef4444' : '#22c55e' }} />
              </div>
            </div>
          </div>
          {overGoal && (
            <p className="text-xs text-center mt-1" style={{ color: '#ef4444' }}>
              {fmtMins(mins - goal)} over your daily goal
            </p>
          )}
        </div>
      )}

      {/* Log form */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Log Screen Time</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Date</label>
            <input
              type="date"
              value={logDate}
              onChange={e => {
                setLogDate(e.target.value)
                const existing = logs.find(l => l.date === e.target.value)
                if (existing) setMinutes(String(existing.minutes))
                else setMinutes('')
              }}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Minutes used</label>
            <input type="number" value={minutes} onChange={e => setMinutes(e.target.value)}
              placeholder="e.g. 90"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Daily goal (minutes)</label>
            <input type="number" value={goalMinutes} onChange={e => setGoalMinutes(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || !minutes || !logDate}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50 mt-3"
          style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white' }}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : logs.find(l => l.date === logDate) ? 'Update screen time' : 'Save screen time'}
        </button>
      </div>

      {/* 14-day chart */}
      {chartData.length > 1 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Last 14 Days</h3>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={goal} stroke="#22c55e" strokeDasharray="4 2" />
              <Tooltip formatter={(val: any) => [fmtMins(val), 'Screen time']}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
              <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.minutes <= goal ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted text-center mt-1">Green line = {fmtMins(goal)} goal</p>
        </div>
      )}

      {/* Recent logs with edit/delete */}
      {logs.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Recent Logs</h3>
          <div className="space-y-2">
            {[...logs].reverse().map((l) => {
              if (editingLog?.id === l.id) {
                return (
                  <div key={l.id} className="flex items-center gap-2">
                    <span className="text-xs text-muted w-24 flex-shrink-0">
                      {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <input type="number" value={editMinutes} onChange={e => setEditMinutes(e.target.value)}
                      autoFocus
                      className="w-20 px-2 py-1 rounded-lg text-sm outline-none"
                      style={{ background: 'var(--surface-2)', border: '1px solid #14b8a6', color: 'var(--foreground)' }} />
                    <span className="text-xs text-muted">min</span>
                    <button onClick={handleEditSave}
                      className="px-2 py-1 rounded-lg text-xs font-semibold"
                      style={{ background: '#14b8a6', color: 'white' }}>OK</button>
                    <button onClick={() => { setEditingLog(null); setEditMinutes('') }}
                      className="px-2 py-1 rounded-lg text-xs"
                      style={{ color: 'var(--muted)' }}>Cancel</button>
                  </div>
                )
              }

              return (
                <div key={l.id} className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted">
                    {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: l.minutes <= goal ? '#22c55e' : '#ef4444' }}>
                      {fmtMins(l.minutes)}
                    </span>
                    <button onClick={() => { setEditingLog(l); setEditMinutes(String(l.minutes)) }}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ color: '#14b8a6' }}>Edit</button>
                    <button onClick={() => handleDelete(l)}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ color: '#ef4444' }}>Del</button>
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
