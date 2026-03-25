'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getUserDoc, updateUserDoc } from '@/lib/firebase/db'
import { signOut } from '@/lib/firebase/auth'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()

  // Telegram
  const [telegramChatId, setTelegramChatId] = useState('')
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramSaved, setTelegramSaved] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    getUserDoc(user.uid).then(doc => {
      if (doc) setTelegramChatId(doc.telegramChatId ?? '')
    })
  }, [user])

  async function saveTelegram() {
    if (!user) return
    setTelegramSaving(true)
    setTelegramError(null)
    try {
      const chatId = telegramChatId.trim()
      await updateUserDoc(user.uid, { telegramChatId: chatId })
      if (chatId) {
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

      {/* Telegram Check-Ins */}
      <div className="card space-y-3">
        <div>
          <h3 className="font-semibold text-sm mb-1">📱 Telegram Check-Ins</h3>
          <p className="text-xs text-muted">Get a nudge every 30 min (10am–3am IST) and reply to update your Time Ledger — no app open needed.</p>
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

        {/* Food logger bot */}
        <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--foreground)' }}>🍽️ Food Logger Bot</p>
          <p className="text-xs text-muted">Log meals in plain English via Telegram — macros auto-filled by AI.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Open <span style={{ color: '#14b8a6', fontWeight: 600 }}>t.me/food_ak_bot</span> — same Chat ID, no extra setup needed.</p>
        </div>
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
