'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, addDocument, updateDocument, where } from '@/lib/firebase/db'

interface LifeOS {
  id?: string
  userId: string
  mission: string
  values: string[]
  beliefs: string[]
  strategies: string[]
  challenges: string[]
  ideas: string[]
  learnedLessons: string[]
  updatedAt: string
}

const SECTIONS = [
  {
    key: 'mission' as const,
    label: '🎯 Life Mission',
    description: 'Your one-sentence reason for being. What are you here to do?',
    type: 'textarea' as const,
    placeholder: 'e.g. Build tools that help people live intentionally and reach their full potential.',
  },
  {
    key: 'values' as const,
    label: '💎 Core Values',
    description: 'The non-negotiable principles you live by.',
    type: 'chips' as const,
    placeholder: 'Add a value (e.g. Family, Health, Growth)',
    suggestions: ['Health', 'Family', 'Growth', 'Integrity', 'Freedom', 'Creativity', 'Impact', 'Learning', 'Discipline', 'Courage'],
  },
  {
    key: 'beliefs' as const,
    label: '🧭 Core Beliefs',
    description: 'What you believe to be true about life, work, people, and success.',
    type: 'chips' as const,
    placeholder: 'Add a belief (e.g. Hard work compounds over time)',
    suggestions: ['Consistency beats intensity', 'Small habits compound', 'Mindset is everything', 'Health is wealth', 'Relationships are the ROI of life'],
  },
  {
    key: 'strategies' as const,
    label: '⚡ Personal Strategies',
    description: 'Your operating principles — how you approach work, decisions, and challenges.',
    type: 'chips' as const,
    placeholder: 'Add a strategy (e.g. Focus on 1 thing at a time)',
    suggestions: ['Deep work blocks', 'Review weekly', '80/20 ruthlessly', 'Say no more than yes', 'Track everything'],
  },
  {
    key: 'challenges' as const,
    label: '🔥 Current Challenges',
    description: 'The obstacles and struggles you are actively working through right now.',
    type: 'chips' as const,
    placeholder: 'Add a challenge (e.g. Procrastination on big tasks)',
    suggestions: [],
  },
  {
    key: 'learnedLessons' as const,
    label: '📖 Lessons Learned',
    description: 'Hard-won insights from experience. What the past has taught you.',
    type: 'chips' as const,
    placeholder: 'Add a lesson (e.g. Energy management matters more than time management)',
    suggestions: [],
  },
  {
    key: 'ideas' as const,
    label: '💡 Ideas Vault',
    description: 'A capture zone for ideas worth remembering — projects, experiments, thoughts.',
    type: 'chips' as const,
    placeholder: 'Add an idea',
    suggestions: [],
  },
]

const VALUE_COLORS: Record<string, string> = {
  mission: '#14b8a6',
  values: '#8b5cf6',
  beliefs: '#f59e0b',
  strategies: '#3b82f6',
  challenges: '#ef4444',
  learnedLessons: '#10b981',
  ideas: '#ec4899',
}

export default function LifeOSPage() {
  const { user } = useAuth()
  const [docId, setDocId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('mission')

  const [data, setData] = useState<Omit<LifeOS, 'id' | 'userId' | 'updatedAt'>>({
    mission: '',
    values: [],
    beliefs: [],
    strategies: [],
    challenges: [],
    ideas: [],
    learnedLessons: [],
  })

  const [chipInputs, setChipInputs] = useState<Record<string, string>>({
    values: '', beliefs: '', strategies: '', challenges: '', ideas: '', learnedLessons: '',
  })

  useEffect(() => {
    if (!user) return
    loadLifeOS()
  }, [user])

  async function loadLifeOS() {
    setLoading(true)
    try {
      const docs = await queryDocuments('life_os', [where('userId', '==', user!.uid)])
      if (docs.length > 0) {
        const d = docs[0] as any
        setDocId(d.id)
        setData({
          mission: d.mission ?? '',
          values: d.values ?? [],
          beliefs: d.beliefs ?? [],
          strategies: d.strategies ?? [],
          challenges: d.challenges ?? [],
          ideas: d.ideas ?? [],
          learnedLessons: d.learnedLessons ?? [],
        })
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function save() {
    if (!user) return
    setSaving(true)
    const payload = { ...data, userId: user.uid, updatedAt: new Date().toISOString() }
    try {
      if (docId) {
        await updateDocument('life_os', docId, payload)
      } else {
        const doc = await addDocument('life_os', payload)
        if (doc?.id) setDocId(doc.id)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  function addChip(key: keyof typeof chipInputs) {
    const val = chipInputs[key].trim()
    if (!val) return
    const arr = (data[key as keyof typeof data] as string[]) ?? []
    if (arr.includes(val)) return
    setData(p => ({ ...p, [key]: [...arr, val] }))
    setChipInputs(p => ({ ...p, [key]: '' }))
  }

  function removeChip(key: string, val: string) {
    setData(p => ({ ...p, [key]: (p[key as keyof typeof p] as string[]).filter((v: string) => v !== val) }))
  }

  function addSuggestion(key: string, val: string) {
    const arr = (data[key as keyof typeof data] as string[]) ?? []
    if (arr.includes(val)) return
    setData(p => ({ ...p, [key]: [...arr, val] }))
  }

  const completionScore = (() => {
    let filled = 0
    if (data.mission.trim().length > 10) filled++
    if (data.values.length >= 3) filled++
    if (data.beliefs.length >= 2) filled++
    if (data.strategies.length >= 2) filled++
    if (data.challenges.length >= 1) filled++
    if (data.learnedLessons.length >= 1) filled++
    if (data.ideas.length >= 1) filled++
    return Math.round((filled / 7) * 100)
  })()

  const currentSection = SECTIONS.find(s => s.key === activeSection)!
  const color = VALUE_COLORS[activeSection] ?? '#14b8a6'

  if (loading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading your Life OS…</div>
  )

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem 6rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>🧬 Life OS</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
              Your identity layer — feeds every AI interaction with deep context about who you are.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saved ? '#10b981' : 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '0.5rem 1.25rem',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              transition: 'background 0.2s',
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save All'}
          </button>
        </div>

        {/* Completion bar */}
        <div style={{ marginTop: '1rem', background: 'var(--surface)', borderRadius: 8, padding: '0.75rem 1rem', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Profile completeness</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: completionScore >= 80 ? '#10b981' : 'var(--color-primary)' }}>{completionScore}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${completionScore}%`, background: completionScore >= 80 ? '#10b981' : 'var(--color-primary)', borderRadius: 99, transition: 'width 0.4s' }} />
          </div>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            The more complete your Life OS, the better your AI coach understands you.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Section nav */}
        <div style={{ minWidth: 180, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0 }}>
          {SECTIONS.map(s => {
            const sColor = VALUE_COLORS[s.key]
            const isActive = activeSection === s.key
            const count = s.key === 'mission'
              ? (data.mission.trim().length > 0 ? 1 : 0)
              : (data[s.key] as string[]).length
            return (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.65rem 1rem',
                  background: isActive ? `${sColor}18` : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? `3px solid ${sColor}` : '3px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  color: isActive ? sColor : 'var(--text-primary)',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: '0.875rem',
                  transition: 'all 0.15s',
                }}
              >
                <span>{s.label.split(' ').slice(1).join(' ')}</span>
                {count > 0 && (
                  <span style={{ background: sColor, color: '#fff', borderRadius: 99, fontSize: '0.7rem', padding: '0 6px', minWidth: 18, textAlign: 'center', lineHeight: '18px', height: 18 }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Section editor */}
        <div style={{ flex: 1, minWidth: 0, background: 'var(--surface)', borderRadius: 12, border: `1px solid ${color}30`, padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem', color }}>{currentSection.label}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '0 0 1rem' }}>{currentSection.description}</p>

          {currentSection.type === 'textarea' ? (
            <textarea
              value={data.mission}
              onChange={e => setData(p => ({ ...p, mission: e.target.value }))}
              placeholder={currentSection.placeholder}
              rows={4}
              style={{
                width: '100%',
                background: 'var(--background)',
                border: `1px solid ${color}50`,
                borderRadius: 8,
                padding: '0.75rem',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <>
              {/* Chip input */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  value={chipInputs[currentSection.key] ?? ''}
                  onChange={e => setChipInputs(p => ({ ...p, [currentSection.key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addChip(currentSection.key as keyof typeof chipInputs)}
                  placeholder={currentSection.placeholder}
                  style={{
                    flex: 1,
                    background: 'var(--background)',
                    border: `1px solid ${color}50`,
                    borderRadius: 8,
                    padding: '0.6rem 0.85rem',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => addChip(currentSection.key as keyof typeof chipInputs)}
                  style={{ background: color, color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  Add
                </button>
              </div>

              {/* Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: (currentSection.suggestions ?? []).length > 0 ? '1rem' : 0 }}>
                {((data[currentSection.key as keyof typeof data] as string[]) ?? []).map((v: string) => (
                  <span
                    key={v}
                    style={{
                      background: `${color}20`,
                      border: `1px solid ${color}50`,
                      color,
                      borderRadius: 99,
                      padding: '0.3rem 0.75rem',
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontWeight: 500,
                    }}
                  >
                    {v}
                    <button
                      onClick={() => removeChip(currentSection.key, v)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 0, fontSize: '0.8rem', lineHeight: 1 }}
                    >✕</button>
                  </span>
                ))}
                {((data[currentSection.key as keyof typeof data] as string[]) ?? []).length === 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>Nothing added yet — type and press Enter or Add</span>
                )}
              </div>

              {/* Suggestions */}
              {(currentSection.suggestions ?? []).length > 0 && (
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>Quick add:</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {currentSection.suggestions!.map(s => {
                      const already = ((data[currentSection.key as keyof typeof data] as string[]) ?? []).includes(s)
                      return (
                        <button
                          key={s}
                          onClick={() => addSuggestion(currentSection.key, s)}
                          disabled={already}
                          style={{
                            background: already ? 'var(--border)' : 'var(--background)',
                            border: `1px solid ${already ? 'var(--border)' : color + '40'}`,
                            color: already ? 'var(--text-muted)' : 'var(--text-primary)',
                            borderRadius: 99,
                            padding: '0.25rem 0.65rem',
                            fontSize: '0.78rem',
                            cursor: already ? 'default' : 'pointer',
                          }}
                        >
                          {already ? '✓ ' : '+ '}{s}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* AI context preview */}
      {completionScore > 0 && (
        <div style={{ marginTop: '1.25rem', background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 12, padding: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.5rem' }}>🤖 AI Context Preview — what your coach knows about you:</p>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
            {data.mission && <p style={{ margin: '0 0 0.25rem' }}><strong>Mission:</strong> {data.mission}</p>}
            {data.values.length > 0 && <p style={{ margin: '0 0 0.25rem' }}><strong>Values:</strong> {data.values.join(', ')}</p>}
            {data.beliefs.length > 0 && <p style={{ margin: '0 0 0.25rem' }}><strong>Believes:</strong> {data.beliefs.join(' • ')}</p>}
            {data.strategies.length > 0 && <p style={{ margin: '0 0 0.25rem' }}><strong>Operates by:</strong> {data.strategies.join(' • ')}</p>}
            {data.challenges.length > 0 && <p style={{ margin: '0 0 0.25rem' }}><strong>Working through:</strong> {data.challenges.join(', ')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
