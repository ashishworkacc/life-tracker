'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface Medication {
  id: string
  name: string
  dosage: string
  frequency: 'morning' | 'evening' | 'both' | 'as needed'
  isActive: boolean
}

interface MedLog {
  medicationId: string
  taken: boolean
}

interface VitalLog {
  id: string
  date: string
  bloodPressure?: string
  bloodSugar?: string
  heartRate?: string
  notes?: string
  medsTaken?: string[]
}

const FREQ_OPTS = ['morning', 'evening', 'both', 'as needed'] as const

export default function VitalsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [medications, setMedications] = useState<Medication[]>([])
  const [medsTakenToday, setMedsTakenToday] = useState<Set<string>>(new Set())
  const [vitalsLog, setVitalsLog] = useState<Partial<VitalLog>>({})
  const [recentLogs, setRecentLogs] = useState<VitalLog[]>([])
  const [loading, setLoading] = useState(true)
  const [todayLogId, setTodayLogId] = useState<string | null>(null)

  // Add med form
  const [showAddMed, setShowAddMed] = useState(false)
  const [editingMed, setEditingMed] = useState<Medication | null>(null)
  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medFreq, setMedFreq] = useState<'morning' | 'evening' | 'both' | 'as needed'>('morning')
  const [savingMed, setSavingMed] = useState(false)

  // Vitals form
  const [bp, setBp] = useState('')
  const [sugar, setSugar] = useState('')
  const [hr, setHr] = useState('')
  const [notes, setNotes] = useState('')
  const [savingVitals, setSavingVitals] = useState(false)
  const [savedVitals, setSavedVitals] = useState(false)

  // Edit recent log
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [editBp, setEditBp] = useState('')
  const [editSugar, setEditSugar] = useState('')
  const [editHr, setEditHr] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingEditLog, setSavingEditLog] = useState(false)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    if (!user) return
    // Load medications list
    const medDocs = await queryDocuments('medications', [
      where('userId', '==', user.uid),
      where('isActive', '==', true),
    ])
    setMedications(medDocs.map(d => ({
      id: d.id, name: d.name, dosage: d.dosage ?? '',
      frequency: d.frequency ?? 'morning', isActive: d.isActive ?? true,
    })))

    // Load today's vitals log
    const todayLogs = await queryDocuments('vitals_logs', [
      where('userId', '==', user.uid),
      where('date', '==', today),
    ])
    if (todayLogs.length > 0) {
      const l = todayLogs[0]
      setTodayLogId(l.id)
      setBp(l.bloodPressure ?? '')
      setSugar(l.bloodSugar ?? '')
      setHr(l.heartRate ?? '')
      setNotes(l.notes ?? '')
      setMedsTakenToday(new Set(l.medsTaken ?? []))
    } else {
      setTodayLogId(null)
    }

    // Load recent vitals logs
    const allLogs = await queryDocuments('vitals_logs', [
      where('userId', '==', user.uid),
      orderBy('date', 'desc'),
    ])
    setRecentLogs(allLogs.slice(0, 7).map(d => ({
      id: d.id,
      date: d.date,
      bloodPressure: d.bloodPressure,
      bloodSugar: d.bloodSugar,
      heartRate: d.heartRate,
      notes: d.notes,
      medsTaken: d.medsTaken ?? [],
    })))
    setLoading(false)
  }

  async function toggleMed(medId: string) {
    if (!user) return
    const newSet = new Set(medsTakenToday)
    if (newSet.has(medId)) newSet.delete(medId)
    else newSet.add(medId)
    setMedsTakenToday(newSet)

    const data = {
      userId: user.uid, date: today,
      bloodPressure: bp || null, bloodSugar: sugar || null,
      heartRate: hr || null, notes: notes || null,
      medsTaken: Array.from(newSet),
    }

    if (todayLogId) {
      await updateDocument('vitals_logs', todayLogId, data)
    } else {
      const docRef = await addDocument('vitals_logs', data)
      setTodayLogId(docRef.id)
    }
  }

  function openAddMed() {
    setEditingMed(null)
    setMedName(''); setMedDosage(''); setMedFreq('morning')
    setShowAddMed(true)
  }

  function openEditMed(med: Medication) {
    setEditingMed(med)
    setMedName(med.name); setMedDosage(med.dosage); setMedFreq(med.frequency)
    setShowAddMed(true)
  }

  async function saveMed() {
    if (!user || !medName.trim()) return
    setSavingMed(true)
    const data = { userId: user.uid, name: medName.trim(), dosage: medDosage.trim(), frequency: medFreq, isActive: true }
    if (editingMed) {
      await updateDocument('medications', editingMed.id, data)
      setMedications(prev => prev.map(m => m.id === editingMed.id ? { ...m, ...data } : m))
    } else {
      const doc = await addDocument('medications', data)
      setMedications(prev => [...prev, { id: (doc as any).id ?? Date.now().toString(), ...data }])
    }
    setShowAddMed(false)
    setSavingMed(false)
  }

  async function archiveMed(id: string) {
    await updateDocument('medications', id, { isActive: false })
    setMedications(prev => prev.filter(m => m.id !== id))
  }

  async function saveVitals() {
    if (!user) return
    setSavingVitals(true)

    const data = {
      userId: user.uid, date: today,
      bloodPressure: bp || null, bloodSugar: sugar || null,
      heartRate: hr || null, notes: notes || null,
      medsTaken: Array.from(medsTakenToday),
    }

    if (todayLogId) {
      await updateDocument('vitals_logs', todayLogId, data)
    } else {
      const docRef = await addDocument('vitals_logs', data)
      setTodayLogId(docRef.id)
    }

    setSavingVitals(false)
    setSavedVitals(true)
    setTimeout(() => setSavedVitals(false), 2000)
    await loadData()
  }

  function startEditLog(log: VitalLog) {
    setEditingLogId(log.id)
    setEditBp(log.bloodPressure ?? '')
    setEditSugar(log.bloodSugar ?? '')
    setEditHr(log.heartRate ?? '')
    setEditNotes(log.notes ?? '')
  }

  function cancelEditLog() {
    setEditingLogId(null)
  }

  async function saveEditLog(log: VitalLog) {
    if (!user) return
    setSavingEditLog(true)
    await updateDocument('vitals_logs', log.id, {
      bloodPressure: editBp || null,
      bloodSugar: editSugar || null,
      heartRate: editHr || null,
      notes: editNotes || null,
    })
    setSavingEditLog(false)
    setEditingLogId(null)
    await loadData()
  }

  async function deleteLog(logId: string) {
    if (!user) return
    await deleteDocument('vitals_logs', logId)
    if (logId === todayLogId) {
      setTodayLogId(null)
      setBp(''); setSugar(''); setHr(''); setNotes('')
      setMedsTakenToday(new Set())
    }
    await loadData()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* ─── MEDICATIONS ─── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">💊 Medications</h3>
          <button onClick={openAddMed}
            className="text-xs px-2.5 py-1 rounded-lg"
            style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
            + Add med
          </button>
        </div>

        {medications.length === 0 ? (
          <p className="text-sm text-muted text-center py-4">
            No medications added yet.<br />
            <span className="text-xs">Add your daily medications to track them.</span>
          </p>
        ) : (
          <div className="space-y-2">
            {medications.map(med => {
              const taken = medsTakenToday.has(med.id)
              return (
                <div key={med.id} className="flex items-center gap-3 p-3 rounded-xl transition-all"
                  style={{
                    background: taken ? 'rgba(34,197,94,0.08)' : 'var(--surface-2)',
                    border: taken ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
                  }}>
                  <button onClick={() => toggleMed(med.id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                    style={{
                      background: taken ? '#22c55e' : 'transparent',
                      border: taken ? 'none' : '2px solid var(--border)',
                      color: 'white',
                    }}>
                    {taken ? '✓' : ''}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{med.name}</p>
                    <p className="text-xs text-muted">
                      {med.dosage && `${med.dosage} · `}{med.frequency}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEditMed(med)}
                      className="text-xs px-1.5 py-1 rounded"
                      style={{ color: 'var(--muted)' }}>✏️</button>
                    <button onClick={() => archiveMed(med.id)}
                      className="text-xs px-1.5 py-1 rounded"
                      style={{ color: '#ef4444' }}>🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {medications.length > 0 && (
          <p className="text-xs text-muted text-center mt-3">
            {medsTakenToday.size}/{medications.length} taken today
          </p>
        )}
      </div>

      {/* ─── ADD/EDIT MED FORM ─── */}
      {showAddMed && (
        <div className="card space-y-3" style={{ border: '1px solid rgba(20,184,166,0.3)' }}>
          <h3 className="font-semibold text-sm">{editingMed ? 'Edit Medication' : 'Add Medication'}</h3>
          <input type="text" value={medName} onChange={e => setMedName(e.target.value)}
            placeholder="Medication name (e.g. Vitamin D)" autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="text" value={medDosage} onChange={e => setMedDosage(e.target.value)}
            placeholder="Dosage (e.g. 500mg, 1 tablet)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div>
            <label className="text-xs text-muted mb-2 block">When</label>
            <div className="flex gap-2 flex-wrap">
              {FREQ_OPTS.map(f => (
                <button key={f} onClick={() => setMedFreq(f)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium capitalize"
                  style={{
                    background: medFreq === f ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                    border: medFreq === f ? '1px solid #14b8a6' : '1px solid var(--border)',
                    color: medFreq === f ? '#14b8a6' : 'var(--muted)',
                  }}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAddMed(false)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveMed} disabled={!medName.trim() || savingMed}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>
              {savingMed ? '...' : editingMed ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ─── VITALS FORM ─── */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-sm">📊 Daily Vitals (optional)</h3>
        {[
          { label: 'Blood Pressure', placeholder: 'e.g. 120/80', val: bp, set: setBp, icon: '❤️' },
          { label: 'Blood Sugar (mg/dL)', placeholder: 'e.g. 95', val: sugar, set: setSugar, icon: '🩸' },
          { label: 'Heart Rate (bpm)', placeholder: 'e.g. 72', val: hr, set: setHr, icon: '💓' },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-3">
            <span className="text-xl w-8">{f.icon}</span>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">{f.label}</label>
              <input type="text" value={f.val} onChange={e => f.set(e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          </div>
        ))}
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Notes (symptoms, how you feel...)" rows={2}
          className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
        <button onClick={saveVitals} disabled={savingVitals}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: savedVitals ? '#22c55e' : '#14b8a6', color: 'white' }}>
          {savingVitals ? 'Saving...' : savedVitals ? '✓ Saved!' : 'Save vitals'}
        </button>
      </div>

      {/* ─── RECENT LOGS ─── */}
      {recentLogs.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">Recent Logs</h3>
          <div className="space-y-3">
            {recentLogs.map(l => {
              const isEditing = editingLogId === l.id
              return (
                <div key={l.id} className="border-b pb-2 last:border-0 last:pb-0" style={{ borderColor: 'var(--border)' }}>
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className="text-xs text-muted">Editing</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="text" value={editBp} onChange={e => setEditBp(e.target.value)}
                          placeholder="BP" className="px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                        <input type="text" value={editSugar} onChange={e => setEditSugar(e.target.value)}
                          placeholder="Sugar" className="px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                        <input type="text" value={editHr} onChange={e => setEditHr(e.target.value)}
                          placeholder="HR" className="px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      </div>
                      <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                        placeholder="Notes" className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      <div className="flex gap-2">
                        <button onClick={cancelEditLog}
                          className="flex-1 py-1.5 rounded-lg text-xs"
                          style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
                        <button onClick={() => saveEditLog(l)} disabled={savingEditLog}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ background: '#14b8a6', color: 'white' }}>
                          {savingEditLog ? '...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          {new Date(l.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">
                            {l.medsTaken && l.medsTaken.length > 0
                              ? `💊 ${l.medsTaken.length} med${l.medsTaken.length > 1 ? 's' : ''} taken`
                              : '💊 no meds logged'}
                          </span>
                          <button onClick={() => startEditLog(l)}
                            className="text-xs px-1 py-0.5 rounded"
                            style={{ color: 'var(--muted)' }}>✏️</button>
                          <button onClick={() => deleteLog(l.id)}
                            className="text-xs px-1 py-0.5 rounded"
                            style={{ color: '#ef4444' }}>🗑️</button>
                        </div>
                      </div>
                      {(l.bloodPressure || l.bloodSugar || l.heartRate) && (
                        <div className="flex gap-3">
                          {l.bloodPressure && <span className="text-xs text-muted">BP: {l.bloodPressure}</span>}
                          {l.bloodSugar && <span className="text-xs text-muted">Sugar: {l.bloodSugar}</span>}
                          {l.heartRate && <span className="text-xs text-muted">HR: {l.heartRate}</span>}
                        </div>
                      )}
                      {l.notes && <p className="text-xs text-muted mt-0.5">{l.notes}</p>}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
