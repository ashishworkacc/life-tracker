'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface Goal {
  id: string
  title: string
  category: string
  startValue: number
  targetValue: number
  currentValue: number
  deadline?: string
  status: 'active' | 'completed' | 'paused'
  resourceUrl?: string
  milestoneCount: number
}

interface Milestone {
  id: string
  goalId: string
  title: string
  description?: string
  order: number
  completed: boolean
}

const CATEGORIES = ['health', 'career', 'learning', 'finance', 'relationships', 'personal']

const categoryIcon: Record<string, string> = {
  health: '💪', career: '💼', learning: '📚', finance: '💰', relationships: '❤️', personal: '🧭'
}

export default function GoalsPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [goals, setGoals] = useState<Goal[]>([])
  const [milestones, setMilestones] = useState<Record<string, Milestone[]>>({})
  const [loading, setLoading] = useState(true)
  const [wizardStep, setWizardStep] = useState(0) // 0=list, 1=goal, 2=milestones
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  // Wizard state
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('health')
  const [startValue, setStartValue] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [deadline, setDeadline] = useState('')
  const [newGoalId, setNewGoalId] = useState<string | null>(null)
  const [milestoneInputs, setMilestoneInputs] = useState(['', '', '', ''])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    loadGoals()
  }, [user])

  async function loadGoals() {
    if (!user) return
    const [goalDocs, milestoneDocs] = await Promise.all([
      queryDocuments('goals', [where('userId', '==', user.uid)]),
      queryDocuments('milestones', [where('userId', '==', user.uid), orderBy('order', 'asc')]),
    ])

    const msMap: Record<string, Milestone[]> = {}
    for (const m of milestoneDocs) {
      if (!msMap[m.goalId]) msMap[m.goalId] = []
      msMap[m.goalId].push({
        id: m.id, goalId: m.goalId, title: m.title,
        description: m.description, order: m.order ?? 0, completed: m.completed ?? false,
      })
    }
    setMilestones(msMap)

    const statusOrder: Record<string, number> = { active: 0, paused: 1, completed: 2 }
    setGoals(goalDocs.map(g => ({
      id: g.id, title: g.title, category: g.category ?? 'personal',
      startValue: g.startValue ?? 0, targetValue: g.targetValue ?? 100,
      currentValue: g.currentValue ?? g.startValue ?? 0,
      deadline: g.deadline, status: g.status ?? 'active',
      resourceUrl: g.resourceUrl, milestoneCount: (msMap[g.id] ?? []).length,
    })).sort((a, b) => (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0)))

    setLoading(false)
  }

  async function saveGoal() {
    if (!user || !title.trim()) return
    setSaving(true)
    const doc = await addDocument('goals', {
      userId: user.uid, title: title.trim(), category,
      startValue: parseFloat(startValue) || 0, targetValue: parseFloat(targetValue) || 100,
      currentValue: parseFloat(startValue) || 0,
      deadline: deadline || null, status: 'active',
    })
    setNewGoalId(doc.id)
    setSaving(false)
    setWizardStep(2)
  }

  async function saveMilestones() {
    if (!user || !newGoalId) return
    setSaving(true)
    const valid = milestoneInputs.filter(m => m.trim())
    for (let i = 0; i < valid.length; i++) {
      await addDocument('milestones', {
        goalId: newGoalId, userId: user.uid, title: valid[i].trim(), order: i, completed: false,
      })
    }
    setSaving(false)
    setWizardStep(0)
    setTitle(''); setCategory('health'); setStartValue(''); setTargetValue(''); setDeadline('')
    setNewGoalId(null); setMilestoneInputs(['', '', '', ''])
    await loadGoals()
  }

  async function saveGoalEdit() {
    if (!user || !editingGoal) return
    await updateDocument('goals', editingGoal.id, {
      title: editingGoal.title, category: editingGoal.category,
      targetValue: editingGoal.targetValue, deadline: editingGoal.deadline || null,
    })
    setGoals(prev => prev.map(g => g.id === editingGoal.id ? { ...g, ...editingGoal } : g))
    setEditingGoal(null)
  }

  async function setGoalStatus(goal: Goal, status: 'active' | 'completed' | 'paused') {
    await updateDocument('goals', goal.id, { status })
    if (status === 'completed') {
      await addDocument('xp_events', {
        userId: user!.uid, date: today, eventType: 'milestone', xpEarned: 200,
        description: `Goal completed: ${goal.title}`,
      })
    }
    setGoals(prev => {
      const statusOrder: Record<string, number> = { active: 0, paused: 1, completed: 2 }
      return prev.map(g => g.id === goal.id ? { ...g, status } : g)
        .sort((a, b) => (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0))
    })
    setMenuId(null)
  }

  async function deleteGoal(goal: Goal) {
    await deleteDocument('goals', goal.id)
    // Also delete milestones
    const ms = milestones[goal.id] ?? []
    for (const m of ms) await deleteDocument('milestones', m.id)
    setGoals(prev => prev.filter(g => g.id !== goal.id))
    setMilestones(prev => { const next = { ...prev }; delete next[goal.id]; return next })
    setMenuId(null)
  }

  async function toggleMilestone(m: Milestone) {
    if (!user) return
    await updateDocument('milestones', m.id, { completed: !m.completed })
    if (!m.completed) {
      await addDocument('xp_events', {
        userId: user.uid, date: today, eventType: 'milestone', xpEarned: 100,
        description: `Milestone: ${m.title}`,
      })
    }
    setMilestones(prev => ({
      ...prev,
      [m.goalId]: (prev[m.goalId] ?? []).map(ms => ms.id === m.id ? { ...ms, completed: !ms.completed } : ms),
    }))
  }

  async function updateGoalValue(goal: Goal, newValue: number) {
    await updateDocument('goals', goal.id, { currentValue: newValue })
    setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, currentValue: newValue } : g))
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading goals...</p></div>

  // Edit goal form
  if (editingGoal) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">Edit Goal</h3>
          <input type="text" value={editingGoal.title}
            onChange={e => setEditingGoal(g => g ? { ...g, title: e.target.value } : null)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />

          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setEditingGoal(g => g ? { ...g, category: cat } : null)}
                className="py-2 rounded-xl text-xs capitalize"
                style={{
                  background: editingGoal.category === cat ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                  border: editingGoal.category === cat ? '1px solid #14b8a6' : '1px solid var(--border)',
                  color: editingGoal.category === cat ? '#14b8a6' : 'var(--muted)',
                }}>
                {categoryIcon[cat]} {cat}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Target value</label>
            <input type="number" value={editingGoal.targetValue || ''}
              onChange={e => setEditingGoal(g => g ? { ...g, targetValue: parseFloat(e.target.value) || 0 } : null)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          </div>

          <div>
            <label className="text-xs text-muted mb-1 block">Deadline</label>
            <input type="date" value={editingGoal.deadline ?? ''}
              onChange={e => setEditingGoal(g => g ? { ...g, deadline: e.target.value } : null)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
          </div>

          <div className="flex gap-2">
            <button onClick={() => setEditingGoal(null)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveGoalEdit} disabled={!editingGoal.title.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>Save</button>
          </div>
        </div>
      </div>
    )
  }

  // Wizard step 1
  if (wizardStep === 1) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setWizardStep(0)} className="text-muted">← Back</button>
          <h2 className="font-semibold text-sm">Step 1: Define Goal</h2>
          <div className="flex gap-1 ml-auto">
            {[1, 2].map(s => (
              <div key={s} className="w-2 h-2 rounded-full"
                style={{ background: wizardStep >= s ? '#14b8a6' : 'var(--surface-2)' }} />
            ))}
          </div>
        </div>
        <div className="card space-y-3">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Goal title (e.g. Lose 10kg by June)" autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className="py-2.5 rounded-xl text-xs font-medium capitalize"
                style={{
                  background: category === cat ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                  border: category === cat ? '1px solid #14b8a6' : '1px solid var(--border)',
                  color: category === cat ? '#14b8a6' : 'var(--muted)',
                }}>
                {categoryIcon[cat]} {cat}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted mb-1 block">Start value</label>
              <input type="number" value={startValue} onChange={e => setStartValue(e.target.value)} placeholder="e.g. 80"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Target value</label>
              <input type="number" value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="e.g. 70"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Deadline</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }} />
          </div>
          <button onClick={saveGoal} disabled={!title.trim() || saving}
            className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
            style={{ background: '#14b8a6', color: 'white' }}>
            {saving ? 'Saving...' : 'Next: Add Milestones →'}
          </button>
        </div>
      </div>
    )
  }

  // Wizard step 2
  if (wizardStep === 2) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-sm">Step 2: Add Milestones</h2>
          <div className="flex gap-1 ml-auto">
            {[1, 2].map(s => (
              <div key={s} className="w-2 h-2 rounded-full"
                style={{ background: wizardStep >= s ? '#14b8a6' : 'var(--surface-2)' }} />
            ))}
          </div>
        </div>
        <div className="card space-y-3">
          <p className="text-xs text-muted">Break your goal into 3-4 key milestones.</p>
          {milestoneInputs.map((val, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-muted w-5">{i + 1}.</span>
              <input type="text" value={val}
                onChange={e => setMilestoneInputs(prev => { const next = [...prev]; next[i] = e.target.value; return next })}
                placeholder={`Milestone ${i + 1}${i === 0 ? ' (required)' : ' (optional)'}`}
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
            </div>
          ))}
          <button onClick={saveMilestones} disabled={!milestoneInputs[0].trim() || saving}
            className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
            style={{ background: '#14b8a6', color: 'white' }}>
            {saving ? 'Saving...' : '✓ Create Goal'}
          </button>
        </div>
      </div>
    )
  }

  const activeGoals = goals.filter(g => g.status === 'active')
  const pausedGoals = goals.filter(g => g.status === 'paused')
  const completedGoals = goals.filter(g => g.status === 'completed')
  const allMilestones = Object.values(milestones).flat()

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{activeGoals.length}</p>
          <p className="text-xs text-muted">Active</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#22c55e' }}>{completedGoals.length}</p>
          <p className="text-xs text-muted">Completed</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#818cf8' }}>
            {allMilestones.filter(m => m.completed).length}
          </p>
          <p className="text-xs text-muted">Milestones</p>
        </div>
      </div>

      {/* Add goal */}
      <button onClick={() => setWizardStep(1)}
        className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
        style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
        <span className="text-lg">+</span> New goal
      </button>

      {/* Goals list */}
      {goals.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-sm text-muted">No goals yet. Create your first!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...activeGoals, ...pausedGoals].map(goal => {
            const range = Math.abs(goal.targetValue - goal.startValue)
            const progress = range > 0 ? Math.abs(goal.currentValue - goal.startValue) / range : 0
            const pct = Math.min(Math.round(progress * 100), 100)
            const ms = milestones[goal.id] ?? []
            const isExpanded = expandedGoal === goal.id

            return (
              <div key={goal.id} className="card" style={{ opacity: goal.status === 'paused' ? 0.7 : 1 }}>
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xl">{categoryIcon[goal.category]}</span>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{goal.title}</p>
                    <div className="flex items-center gap-2">
                      {goal.status === 'paused' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>Paused</span>
                      )}
                      {goal.deadline && (
                        <span className="text-xs text-muted">
                          Due {new Date(goal.deadline + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold" style={{ color: '#14b8a6' }}>{pct}%</span>
                    <button onClick={() => setMenuId(menuId === goal.id ? null : goal.id)}
                      className="text-muted px-1">⋯</button>
                  </div>
                </div>

                {/* Menu */}
                {menuId === goal.id && (
                  <div className="flex gap-2 mb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => { setEditingGoal(goal); setMenuId(null) }}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                    {goal.status === 'active' ? (
                      <button onClick={() => setGoalStatus(goal, 'paused')}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>⏸ Pause</button>
                    ) : (
                      <button onClick={() => setGoalStatus(goal, 'active')}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>▶ Resume</button>
                    )}
                    <button onClick={() => setGoalStatus(goal, 'completed')}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>✓ Done</button>
                    <button onClick={() => deleteGoal(goal)}
                      className="py-1.5 px-2 rounded-lg text-xs"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>🗑️</button>
                  </div>
                )}

                {/* Progress bar */}
                <div className="w-full rounded-full h-2.5 mb-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: '#14b8a6' }} />
                </div>

                <div className="flex justify-between text-xs text-muted mb-3">
                  <span>Start: {goal.startValue}</span>
                  <span>Current: {goal.currentValue}</span>
                  <span>Target: {goal.targetValue}</span>
                </div>

                {/* Quick update current value */}
                <div className="flex gap-2 mb-3">
                  <input type="number" defaultValue={goal.currentValue}
                    onBlur={e => {
                      const val = parseFloat(e.target.value)
                      if (!isNaN(val) && val !== goal.currentValue) updateGoalValue(goal, val)
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                  <span className="flex items-center text-xs text-muted">current value</span>
                </div>

                {/* Milestones */}
                {ms.length > 0 && (
                  <>
                    <button onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                      className="w-full text-xs text-muted py-1 flex items-center gap-2">
                      {isExpanded ? '▲' : '▶'}
                      Milestones ({ms.filter(m => m.completed).length}/{ms.length} done)
                    </button>
                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        {ms.map(m => (
                          <button key={m.id} onClick={() => toggleMilestone(m)}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left"
                            style={{
                              background: m.completed ? 'rgba(34,197,94,0.1)' : 'var(--surface-2)',
                              border: m.completed ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)',
                            }}>
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                              style={{ background: m.completed ? '#22c55e' : 'transparent', border: m.completed ? 'none' : '2px solid var(--border)', color: 'white' }}>
                              {m.completed ? '✓' : ''}
                            </span>
                            <span className="text-sm flex-1"
                              style={{ textDecoration: m.completed ? 'line-through' : 'none', color: m.completed ? 'var(--muted)' : 'var(--foreground)' }}>
                              {m.title}
                            </span>
                            {m.completed && <span className="text-xs" style={{ color: '#22c55e' }}>+100 XP</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {/* Completed goals */}
          {completedGoals.length > 0 && (
            <div>
              <button onClick={() => setShowCompleted(!showCompleted)}
                className="w-full flex items-center justify-between py-2 text-sm text-muted">
                <span>✅ Completed ({completedGoals.length})</span>
                <span>{showCompleted ? '▲' : '▶'}</span>
              </button>
              {showCompleted && (
                <div className="space-y-2 mt-2">
                  {completedGoals.map(goal => (
                    <div key={goal.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <span className="text-xl">{categoryIcon[goal.category]}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{goal.title}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setGoalStatus(goal, 'active')}
                          className="text-xs px-2 py-1 rounded" style={{ color: '#14b8a6' }}>↩</button>
                        <button onClick={() => deleteGoal(goal)}
                          className="text-xs px-1.5 py-1 rounded" style={{ color: '#ef4444' }}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
