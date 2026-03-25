'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where } from '@/lib/firebase/db'

interface FoodEntry {
  id: string
  mealType: string
  description: string
  quantity?: number
  unit?: string
  protein: number
  carbs: number
  fat: number
  calories: number
  zomatoOrdered: boolean
}

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
const MEAL_ICONS: Record<string, string> = { Breakfast: '🌅', Lunch: '☀️', Dinner: '🌙', Snack: '🍎' }
const UNITS = ['g', 'ml', 'cup', 'piece', 'tbsp', 'tsp', 'serving', 'bowl', 'plate', 'glass']

export default function FoodTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Add/edit modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeMeal, setActiveMeal] = useState('Breakfast')
  const [desc, setDesc] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('g')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [calories, setCalories] = useState('')
  const [zomato, setZomato] = useState(false)
  const [entryDate, setEntryDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    if (!user) return
    loadEntries()
  }, [user])

  async function loadEntries() {
    if (!user) return
    const docs = await queryDocuments('food_logs', [
      where('userId', '==', user.uid),
      where('date', '==', today),
    ])
    setEntries(docs.map(d => ({
      id: d.id,
      mealType: d.mealType,
      description: d.description,
      quantity: d.quantity,
      unit: d.unit,
      protein: d.protein ?? 0,
      carbs: d.carbs ?? 0,
      fat: d.fat ?? 0,
      calories: d.calories ?? 0,
      zomatoOrdered: d.zomatoOrdered ?? false,
    })).sort((a, b) => MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType)))
    setLoading(false)
  }

  function openAdd(meal: string) {
    setEditingId(null)
    setActiveMeal(meal)
    setEntryDate(today)
    setDesc(''); setQuantity(''); setUnit('g')
    setProtein(''); setCarbs(''); setFat(''); setCalories(''); setZomato(false)
    setAiError('')
    setModalOpen(true)
  }

  function openEdit(entry: FoodEntry) {
    setEditingId(entry.id)
    setActiveMeal(entry.mealType)
    setEntryDate((entry as any).date ?? today)
    setDesc(entry.description)
    setQuantity(String(entry.quantity || ''))
    setUnit(entry.unit || 'g')
    setProtein(String(entry.protein || ''))
    setCarbs(String(entry.carbs || ''))
    setFat(String(entry.fat || ''))
    setCalories(String(entry.calories || ''))
    setZomato(entry.zomatoOrdered)
    setAiError('')
    setModalOpen(true)
  }

  async function fillWithAI() {
    if (!desc.trim()) return
    setAiLoading(true)
    setAiError('')
    try {
      const res = await fetch('/api/ai/macros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food: desc.trim(), quantity: quantity || null, unit }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.calories != null) setCalories(String(data.calories))
      if (data.protein != null) setProtein(String(data.protein))
      if (data.carbs != null) setCarbs(String(data.carbs))
      if (data.fat != null) setFat(String(data.fat))
      if (!data.calories && !data.protein && !data.carbs && !data.fat) {
        setAiError('AI could not estimate — fill manually')
      }
    } catch {
      setAiError('AI unavailable — fill manually')
    }
    setAiLoading(false)
  }

  async function saveEntry() {
    if (!user || !desc.trim()) return
    setSaving(true)
    const data = {
      userId: user.uid,
      date: entryDate,
      mealType: activeMeal,
      description: desc.trim(),
      quantity: parseFloat(quantity) || null,
      unit: unit || null,
      protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0,
      fat: parseFloat(fat) || 0,
      calories: parseFloat(calories) || 0,
      zomatoOrdered: zomato,
    }
    if (editingId) {
      await updateDocument('food_logs', editingId, data)
      setEntries(prev => prev.map(e => e.id === editingId ? { id: editingId, ...data, fat: data.fat, quantity: data.quantity ?? undefined, unit: data.unit ?? undefined } : e))
    } else {
      await addDocument('food_logs', data)
      await loadEntries()
    }
    setModalOpen(false)
    setSaving(false)
  }

  async function deleteEntry(id: string) {
    await deleteDocument('food_logs', id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const totalProtein = entries.reduce((s, e) => s + e.protein, 0)
  const totalCarbs = entries.reduce((s, e) => s + e.carbs, 0)
  const totalFat = entries.reduce((s, e) => s + e.fat, 0)
  const totalCalories = entries.reduce((s, e) => s + e.calories, 0)
  const zomatoCount = entries.filter(e => e.zomatoOrdered).length

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading food log...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Daily totals */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Today&apos;s Totals</h3>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Calories', val: Math.round(totalCalories), color: '#22c55e', unit: '' },
            { label: 'Protein', val: Math.round(totalProtein), color: '#14b8a6', unit: 'g' },
            { label: 'Carbs', val: Math.round(totalCarbs), color: '#f59e0b', unit: 'g' },
            { label: 'Fat', val: Math.round(totalFat), color: '#818cf8', unit: 'g' },
          ].map(m => (
            <div key={m.label} className="text-center">
              <p className="text-lg font-bold" style={{ color: m.color }}>{m.val}{m.unit}</p>
              <p className="text-[10px] text-muted">{m.label}</p>
            </div>
          ))}
        </div>
        {zomatoCount > 0 && (
          <p className="text-xs mt-2 text-center" style={{ color: '#ef4444' }}>
            🛵 {zomatoCount} Zomato order{zomatoCount > 1 ? 's' : ''} today
          </p>
        )}
      </div>

      {/* Meal sections */}
      {MEAL_TYPES.map(meal => {
        const mealEntries = entries.filter(e => e.mealType === meal)
        const mealCals = mealEntries.reduce((s, e) => s + e.calories, 0)
        return (
          <div key={meal} className="card">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-semibold text-sm">{MEAL_ICONS[meal]} {meal}</h3>
                {mealCals > 0 && <p className="text-xs text-muted">{Math.round(mealCals)} cal</p>}
              </div>
              <button onClick={() => openAdd(meal)}
                className="text-xs px-2.5 py-1 rounded-lg"
                style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                + Add
              </button>
            </div>
            {mealEntries.length === 0 ? (
              <p className="text-xs text-muted">Not logged yet</p>
            ) : (
              <div className="space-y-2">
                {mealEntries.map(e => (
                  <div key={e.id} className="flex items-start gap-2 p-2 rounded-lg"
                    style={{ background: 'var(--surface-2)' }}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{e.description}
                        {e.quantity && <span className="text-xs text-muted ml-1">({e.quantity}{e.unit})</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {e.calories > 0 && `${e.calories} cal`}
                        {e.protein > 0 && ` · ${e.protein}g protein`}
                        {e.carbs > 0 && ` · ${e.carbs}g carbs`}
                        {e.fat > 0 && ` · ${e.fat}g fat`}
                        {e.zomatoOrdered && ' · 🛵'}
                      </p>
                    </div>
                    <button onClick={() => openEdit(e)}
                      className="text-xs px-1.5 py-1 rounded flex-shrink-0"
                      style={{ color: '#14b8a6' }}>✏️</button>
                    <button onClick={() => deleteEntry(e.id)}
                      className="text-xs px-1.5 py-1 rounded flex-shrink-0"
                      style={{ color: '#ef4444' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Add/Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-lg mx-auto rounded-t-2xl p-5 space-y-3 animate-slide-up"
            style={{ background: 'var(--background)' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editingId ? 'Edit' : 'Add to'} {activeMeal}</h3>
              <button onClick={() => setModalOpen(false)} className="text-muted text-lg">✕</button>
            </div>

            {/* Date picker */}
            <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }} />

            {/* Food name */}
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="What did you eat?" autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />

            {/* Quantity + Unit */}
            <div className="flex gap-2">
              <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                placeholder="Qty"
                className="w-20 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
              <div className="flex gap-1 flex-wrap flex-1">
                {UNITS.map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    className="px-2 py-1 rounded-lg text-xs"
                    style={{
                      background: unit === u ? 'rgba(20,184,166,0.15)' : 'var(--surface)',
                      border: unit === u ? '1px solid #14b8a6' : '1px solid var(--border)',
                      color: unit === u ? '#14b8a6' : 'var(--muted)',
                    }}>
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* AI fill button */}
            <button onClick={fillWithAI} disabled={!desc.trim() || aiLoading}
              className="w-full py-2 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
              {aiLoading ? '🤔 Estimating...' : '✨ AI Fill Macros'}
            </button>
            {aiError && (
              <p className="text-xs text-center" style={{ color: '#ef4444' }}>{aiError}</p>
            )}

            {/* Macros */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Calories', val: calories, set: setCalories },
                { label: 'Protein g', val: protein, set: setProtein },
                { label: 'Carbs g', val: carbs, set: setCarbs },
                { label: 'Fat g', val: fat, set: setFat },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[10px] text-muted mb-1 block">{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg text-sm outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                </div>
              ))}
            </div>

            <button onClick={() => setZomato(!zomato)}
              className="flex items-center gap-2 text-sm"
              style={{ color: zomato ? '#ef4444' : 'var(--muted)' }}>
              <span className="w-5 h-5 rounded flex items-center justify-center text-xs"
                style={{ background: zomato ? 'rgba(239,68,68,0.15)' : 'var(--surface)', border: `1px solid ${zomato ? '#ef4444' : 'var(--border)'}`, color: '#ef4444' }}>
                {zomato ? '✓' : ''}
              </span>
              🛵 Ordered via Zomato
            </button>

            <div className="flex gap-2">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 py-3 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)' }}>Cancel</button>
              <button onClick={saveEntry} disabled={!desc.trim() || saving}
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: '#14b8a6', color: 'white' }}>
                {saving ? '...' : editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
