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
  const [dayStartHour, setDayStartHour] = useState(5) // Custom day reset — default 5 AM
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Telegram
  const [telegramChatId, setTelegramChatId] = useState('')
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramSaved, setTelegramSaved] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)

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
      setDayStartHour(doc.dayStartHour ?? 5)
      setTelegramChatId(doc.telegramChatId ?? '')
    }
  }

  async function saveSettings() {
    if (!user) return
    setSaving(true)
    await updateUserDoc(user.uid, {
      identityStatement,
      graceModeEnabled,
      dayStartHour,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function saveTelegram() {
    if (!user) return
    setTelegramSaving(true)
    setTelegramError(null)
    try {
      const chatId = telegramChatId.trim()
      // Save chatId on user doc
      await updateUserDoc(user.uid, { telegramChatId: chatId })

      if (chatId) {
        // Write telegram_links via server-side route (Admin SDK)
        const res = await fetch('/api/telegram/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, chatId }),
        })
        if (!res.ok) throw new Error('Failed to link Telegram')
      }

      setTelegramSaved(true)
      setTimeout(() => setTelegramSaved(false), 2000)
    } catch (err: any) {
      setTelegramError(err.message ?? 'Failed to save')
    } finally {
      setTelegramSaving(false)
    }
  }

  async function disconnectTelegram() {
    if (!user || !telegramChatId) return
    setTelegramSaving(true)
    try {
      await fetch('/api/telegram/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: telegramChatId }),
      })
      await updateUserDoc(user.uid, { telegramChatId: '' })
      setTelegramChatId('')
    } catch {
      // best-effort
    } finally {
      setTelegramSaving(false)
    }
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

      {/* Custom Day Reset */}
      <div className="card space-y-3">
        <div>
          <h3 className="font-semibold text-sm mb-1">🌙 Custom Day Reset</h3>
          <p className="text-xs text-muted">Your "today" rolls over at this hour — ideal if you work late nights or past midnight.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            type="range" min={0} max={8} step={1}
            value={dayStartHour}
            onChange={e => setDayStartHour(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#14b8a6' }}
          />
          <span style={{ minWidth: 56, textAlign: 'center', fontWeight: 700, color: '#14b8a6', fontSize: '0.9rem' }}>
            {dayStartHour === 0 ? 'Midnight' : `${dayStartHour}:00 AM`}
          </span>
        </div>
        <p className="text-[10px] text-muted">
          If you sleep at 3 AM, set this to 4–5 AM so your habits reset after you sleep, not while you&apos;re still awake.
        </p>
      </div>

      {/* Telegram Check-Ins */}
      <div className="card space-y-3">
        <div>
          <h3 className="font-semibold text-sm mb-1">📱 Telegram Check-Ins</h3>
          <p className="text-xs text-muted">Get a nudge every 30 min and reply to update your Time Ledger — no app open needed.</p>
        </div>
        <div className="space-y-2 text-xs" style={{ color: 'var(--muted)' }}>
          <p>1. Open <span style={{ color: '#14b8a6', fontWeight: 600 }}>t.me/ledger_ak_bot</span> → send <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 4 }}>/start</code></p>
          <p>2. Copy the Chat ID the bot sends back and paste it below</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={telegramChatId}
            onChange={e => setTelegramChatId(e.target.value)}
            placeholder="Your Telegram Chat ID"
            className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
          <button
            onClick={saveTelegram}
            disabled={telegramSaving}
            className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: telegramSaved ? '#22c55e' : '#14b8a6', color: 'white', whiteSpace: 'nowrap' }}
          >
            {telegramSaving ? '...' : telegramSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        {telegramError && <p className="text-xs" style={{ color: '#ef4444' }}>{telegramError}</p>}
        {telegramChatId && !telegramError && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p className="text-xs" style={{ color: '#22c55e' }}>✓ Connected (ID: {telegramChatId})</p>
            <button onClick={disconnectTelegram} className="text-xs" style={{ color: '#ef4444' }}>Disconnect</button>
          </div>
        )}
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
