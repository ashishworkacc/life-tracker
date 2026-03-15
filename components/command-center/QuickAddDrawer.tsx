'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, todayDate } from '@/lib/firebase/db'

interface Props {
  open: boolean
  onClose: () => void
}

const ACTIVITY_TAGS = [
  { emoji: '☕', label: 'Morning' },
  { emoji: '🍽️', label: 'Eating' },
  { emoji: '💻', label: 'Working' },
  { emoji: '🏋️', label: 'Exercise' },
  { emoji: '🚗', label: 'Commute' },
  { emoji: '😴', label: 'Resting' },
  { emoji: '📚', label: 'Learning' },
  { emoji: '🤝', label: 'Social' },
  { emoji: '🏠', label: 'Home' },
  { emoji: '🛁', label: 'Self-care' },
]

const MOOD_EMOJIS = ['😔', '😐', '🙂', '😊', '🚀']
const MOOD_LABELS = ['Low', 'Meh', 'Okay', 'Good', 'Great']

export default function QuickAddDrawer({ open, onClose }: Props) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!open) return null

  async function handleSave() {
    if (!user || (!text.trim() && mood === null && !activity)) return
    setSaving(true)
    const now = new Date()
    await addDocument('activity_logs', {
      userId: user.uid,
      text: text.trim(),
      mood: mood,
      activityTag: activity,
      timestamp: now.toISOString(),
      date: todayDate(),
      hour: now.getHours(),
    })
    setText(''); setMood(null); setActivity(null)
    setSaving(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl p-5 animate-slide-up max-w-lg mx-auto"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} />
        <h3 className="font-semibold text-base mb-1">Life Log</h3>
        <p className="text-xs text-muted mb-4">What&apos;s happening right now? AI reads this to understand your day.</p>

        {/* Free text */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="e.g. Brushed teeth, had a bath. Going for lunch now. Feeling a bit tired today…"
          rows={3}
          autoFocus
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none mb-3"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        />

        {/* Activity tag */}
        <p className="text-xs text-muted mb-2">Activity</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {ACTIVITY_TAGS.map(tag => (
            <button key={tag.label} onClick={() => setActivity(activity === tag.label ? null : tag.label)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: activity === tag.label ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                border: activity === tag.label ? '1.5px solid #14b8a6' : '1px solid var(--border)',
                color: activity === tag.label ? '#14b8a6' : 'var(--muted)',
              }}>
              {tag.emoji} {tag.label}
            </button>
          ))}
        </div>

        {/* Mood */}
        <p className="text-xs text-muted mb-2">Mood right now</p>
        <div className="flex gap-2 mb-4">
          {MOOD_EMOJIS.map((emoji, i) => (
            <button key={i} onClick={() => setMood(mood === i + 1 ? null : i + 1)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl transition-all"
              style={{
                background: mood === i + 1 ? 'rgba(20,184,166,0.12)' : 'var(--surface-2)',
                border: mood === i + 1 ? '1.5px solid #14b8a6' : '1px solid var(--border)',
              }}>
              <span className="text-xl">{emoji}</span>
              <span className="text-[9px]" style={{ color: mood === i + 1 ? '#14b8a6' : 'var(--muted)' }}>{MOOD_LABELS[i]}</span>
            </button>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={saving || (!text.trim() && mood === null && !activity)}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: '#14b8a6', color: 'white' }}
        >
          {saving ? 'Saving…' : 'Log it'}
        </button>
      </div>
    </>
  )
}
