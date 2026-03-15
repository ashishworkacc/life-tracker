'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getUserDoc, updateUserDoc } from '@/lib/firebase/db'
import { signOut } from '@/lib/firebase/auth'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [identityStatement, setIdentityStatement] = useState('')
  const [graceModeEnabled, setGraceModeEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    loadSettings()
  }, [user])

  async function loadSettings() {
    if (!user) return
    const doc = await getUserDoc(user.uid)
    if (doc) {
      setIdentityStatement(doc.identityStatement ?? '')
      setGraceModeEnabled(doc.graceModeEnabled ?? false)
    }
  }

  async function saveSettings() {
    if (!user) return
    setSaving(true)
    await updateUserDoc(user.uid, {
      identityStatement,
      graceModeEnabled,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Profile */}
      <div className="card">
        <h3 className="font-semibold text-sm mb-3">Profile</h3>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
            style={{ background: 'rgba(20,184,166,0.15)', border: '2px solid #14b8a6' }}>
            {user?.displayName?.[0] ?? user?.email?.[0] ?? '?'}
          </div>
          <div>
            <p className="font-medium text-sm">{user?.displayName ?? 'User'}</p>
            <p className="text-xs text-muted">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Identity statement */}
      <div className="card space-y-3">
        <div>
          <h3 className="font-semibold text-sm mb-1">Identity Statement</h3>
          <p className="text-xs text-muted">This appears at the top of your Command Center as a daily reminder.</p>
        </div>
        <textarea
          value={identityStatement}
          onChange={e => setIdentityStatement(e.target.value)}
          placeholder="e.g. I am someone who takes care of their health every day"
          rows={2}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      {/* Grace mode */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm mb-1">Grace Mode</h3>
            <p className="text-xs text-muted">Allow one missed day before breaking habit streaks.</p>
          </div>
          <button
            onClick={() => setGraceModeEnabled(!graceModeEnabled)}
            className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
            style={{ background: graceModeEnabled ? '#14b8a6' : 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
              style={{ left: graceModeEnabled ? '22px' : '2px' }} />
          </button>
        </div>
      </div>

      {/* Save */}
      <button onClick={saveSettings} disabled={saving}
        className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
        style={{ background: saved ? '#22c55e' : '#14b8a6', color: 'white' }}>
        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
      </button>

      {/* Links */}
      <div className="card space-y-2">
        <h3 className="font-semibold text-sm mb-2">Quick Links</h3>
        {[
          { href: '/counters', label: '🎯 Custom Counters', desc: 'Manage your count trackers' },
          { href: '/gamification', label: '⚡ XP & Badges', desc: 'View your level and achievements' },
          { href: '/ai-insights', label: '🤖 AI Insights', desc: 'View AI-generated insights' },
          { href: '/chat', label: '💬 AI Chat', desc: 'Chat with your AI assistant' },
        ].map(link => (
          <a key={link.href} href={link.href}
            className="flex items-center justify-between px-3 py-2.5 rounded-xl"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-sm">{link.label}</p>
              <p className="text-xs text-muted">{link.desc}</p>
            </div>
            <span className="text-muted">→</span>
          </a>
        ))}
      </div>

      {/* App info */}
      <div className="card text-center space-y-1">
        <p className="text-sm font-semibold" style={{ color: '#14b8a6' }}>LifeTracker</p>
        <p className="text-xs text-muted">All features free at launch 🎉</p>
        <p className="text-xs text-muted">Powered by DeepSeek V3 via OpenRouter</p>
      </div>

      {/* Sign out */}
      <button onClick={handleSignOut}
        className="w-full py-3 rounded-xl text-sm"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
        Sign out
      </button>
    </div>
  )
}
