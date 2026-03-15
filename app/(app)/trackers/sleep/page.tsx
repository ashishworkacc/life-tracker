'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy, limit } from '@/lib/firebase/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

interface SleepLog {
  id: string
  date: string
  bedtime: string
  wakeTime: string
  hoursSlept: number
}

function calcHours(bedtime: string, wakeTime: string) {
  const [bh, bm] = bedtime.split(':').map(Number)
  const [wh, wm] = wakeTime.split(':').map(Number)
  let diff = (wh * 60 + wm) - (bh * 60 + bm)
  if (diff < 0) diff += 24 * 60
  return Math.round(diff / 60 * 10) / 10
}

export default function SleepTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [logDate, setLogDate] = useState(today)
  const [bedtime, setBedtime] = useState('23:00')
  const [wakeTime, setWakeTime] = useState('07:00')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logs, setLogs] = useState<SleepLog[]>([])
  const [editingLog, setEditingLog] = useState<SleepLog | null>(null)
  const [editBedtime, setEditBedtime] = useState('')
  const [editWakeTime, setEditWakeTime] = useState('')

  const hoursSlept = calcHours(bedtime, wakeTime)

  useEffect(() => {
    if (!user) return
    loadLogs()
  }, [user])

  async function loadLogs() {
    if (!user) return
    const docs = await queryDocuments('sleep_logs', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
      limit(30),
    ])
    const mapped = docs.map(d => ({
      id: d.id,
      date: d.date,
      bedtime: d.bedtime,
      wakeTime: d.wakeTime,
      hoursSlept: d.hoursSlept ?? 0,
    }))
    const todayLog = mapped.find(d => d.date === today)
    if (todayLog) {
      setBedtime(todayLog.bedtime ?? '23:00')
      setWakeTime(todayLog.wakeTime ?? '07:00')
    }
    setLogs(mapped.reverse())
  }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const existing = logs.find(l => l.date === logDate)
    if (existing) {
      await updateDocument('sleep_logs', existing.id, { bedtime, wakeTime, hoursSlept })
    } else {
      await addDocument('sleep_logs', {
        userId: user.uid, date: logDate, bedtime, wakeTime, hoursSlept,
      })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await loadLogs()
  }

  async function handleEditSave() {
    if (!editingLog || !editBedtime || !editWakeTime) return
    const newHours = calcHours(editBedtime, editWakeTime)
    await updateDocument('sleep_logs', editingLog.id, {
      bedtime: editBedtime, wakeTime: editWakeTime, hoursSlept: newHours,
    })
    setEditingLog(null)
    setEditBedtime('')
    setEditWakeTime('')
    await loadLogs()
  }

  async function handleDelete(log: SleepLog) {
    await deleteDocument('sleep_logs', log.id)
    setLogs(prev => prev.filter(l => l.id !== log.id))
    if (log.date === logDate) {
      setBedtime('23:00')
      setWakeTime('07:00')
    }
  }

  const avgSleep = logs.length
    ? Math.round((logs.reduce((s, l) => s + l.hoursSlept, 0) / logs.length) * 10) / 10
    : 0
  const below6Nights = logs.filter(l => l.hoursSlept < 6).length

  const chartData = logs.slice(-14).map(l => ({
    day: new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }).slice(0, 5),
    hours: l.hoursSlept,
  }))

  const sleepQuality = hoursSlept >= 7.5 ? { label: 'Excellent', color: '#22c55e' }
    : hoursSlept >= 6.5 ? { label: 'Good', color: '#86efac' }
      : hoursSlept >= 5.5 ? { label: 'Fair', color: '#fcd34d' }
        : { label: 'Poor', color: '#fca5a5' }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#818cf8' }}>{avgSleep}h</p>
          <p className="text-xs text-muted">30-day avg</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: below6Nights > 5 ? '#ef4444' : '#22c55e' }}>{below6Nights}</p>
          <p className="text-xs text-muted">Nights &lt; 6h</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: sleepQuality.color }}>{hoursSlept}h</p>
          <p className="text-xs text-muted">Tonight</p>
        </div>
      </div>

      {/* Log form */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Log Sleep</h3>
        <div className="mb-3">
          <label className="text-xs text-muted mb-1 block">Date</label>
          <input
            type="date"
            value={logDate}
            onChange={e => {
              setLogDate(e.target.value)
              const existing = logs.find(l => l.date === e.target.value)
              if (existing) {
                setBedtime(existing.bedtime)
                setWakeTime(existing.wakeTime)
              } else {
                setBedtime('23:00')
                setWakeTime('07:00')
              }
            }}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Bedtime</label>
            <input type="time" value={bedtime} onChange={e => setBedtime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Wake time</label>
            <input type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-sm text-muted">Sleep duration</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{hoursSlept}h</span>
            <span className="text-sm font-medium" style={{ color: sleepQuality.color }}>{sleepQuality.label}</span>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
          style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white' }}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : logs.find(l => l.date === logDate) ? 'Update sleep log' : 'Save sleep log'}
        </button>
      </div>

      {/* 14-day chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Sleep History</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={7} stroke="#22c55e" strokeDasharray="4 2" />
              <Tooltip formatter={(val: any) => [`${val}h`, 'Sleep']}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.hours >= 7 ? '#818cf8' : d.hours >= 6 ? '#a5b4fc' : '#fca5a5'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted text-center mt-1">Green line = 7h target</p>
        </div>
      )}

      {/* Recent logs with edit/delete */}
      {logs.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Recent Logs</h3>
          <div className="space-y-2">
            {[...logs].reverse().slice(0, 14).map(l => {
              if (editingLog?.id === l.id) {
                return (
                  <div key={l.id} className="space-y-1.5 py-1 px-1 rounded-lg" style={{ background: 'var(--surface-2)' }}>
                    <span className="text-xs text-muted">
                      {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <div className="flex items-center gap-2">
                      <input type="time" value={editBedtime} onChange={e => setEditBedtime(e.target.value)}
                        autoFocus
                        className="flex-1 px-2 py-1 rounded-lg text-sm outline-none"
                        style={{ background: 'var(--surface)', border: '1px solid #14b8a6', color: 'var(--foreground)' }} />
                      <span className="text-xs text-muted">to</span>
                      <input type="time" value={editWakeTime} onChange={e => setEditWakeTime(e.target.value)}
                        className="flex-1 px-2 py-1 rounded-lg text-sm outline-none"
                        style={{ background: 'var(--surface)', border: '1px solid #14b8a6', color: 'var(--foreground)' }} />
                      <button onClick={handleEditSave}
                        className="px-2 py-1 rounded-lg text-xs font-semibold"
                        style={{ background: '#14b8a6', color: 'white' }}>✓</button>
                      <button onClick={() => { setEditingLog(null); setEditBedtime(''); setEditWakeTime('') }}
                        className="px-2 py-1 rounded-lg text-xs"
                        style={{ color: 'var(--muted)' }}>✕</button>
                    </div>
                  </div>
                )
              }

              return (
                <div key={l.id} className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted">
                    {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">{l.bedtime} → {l.wakeTime}</span>
                    <span className="text-sm font-semibold"
                      style={{ color: l.hoursSlept >= 7 ? '#818cf8' : l.hoursSlept < 6 ? '#fca5a5' : 'var(--foreground)' }}>
                      {l.hoursSlept}h
                    </span>
                    <button onClick={() => { setEditingLog(l); setEditBedtime(l.bedtime); setEditWakeTime(l.wakeTime) }}
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
