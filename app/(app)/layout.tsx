'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'
import SideNav from '@/components/layout/SideNav'
import FloatingActions from '@/components/layout/FloatingActions'

const NUDGE_MESSAGES = [
  "Stop overthinking. Open the task and write the first word.",
  "You don't need more preparation. Start for 2 minutes.",
  "The best time was earlier. The second best time is now.",
  "Action kills anxiety. What's the next physical step?",
  "You've been idle 15 minutes. One block. That's all.",
  "Progress over perfection. Ship the imperfect version.",
  "Momentum is everything. Break the stillness — now.",
]

function AntiProcrastinationNudge() {
  const pathname = usePathname()
  const [nudge, setNudge] = useState<string | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const IDLE_MS = 15 * 60 * 1000 // 15 min idle

  function resetIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      // Don't nudge if user is on Pomodoro (they're actively working)
      if (pathname === '/now') return
      const msg = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)]
      setNudge(msg)
    }, IDLE_MS)
  }

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll']
    events.forEach(e => window.addEventListener(e, resetIdle, { passive: true }))
    resetIdle()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [pathname])

  if (!nudge) return null

  return (
    <div style={{
      position: 'fixed', bottom: '5.5rem', left: '50%', transform: 'translateX(-50%)',
      zIndex: 300, maxWidth: 340, width: 'calc(100% - 2rem)',
      background: 'linear-gradient(135deg,#1e1b4b,#0f172a)',
      border: '1px solid rgba(99,102,241,0.4)',
      borderRadius: 16, padding: '1rem 1.1rem',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'slideUp 0.3s ease',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#818cf8', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Anti-Procrastination</p>
          <p style={{ fontSize: '0.85rem', color: '#e2e8f0', margin: 0, lineHeight: 1.4, fontWeight: 600 }}>{nudge}</p>
        </div>
        <button onClick={() => { setNudge(null); resetIdle() }}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1rem', flexShrink: 0, padding: 0 }}>✕</button>
      </div>
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="w-10 h-10 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40" style={{ width: 220 }}>
        <SideNav />
      </aside>

      {/* ── Mobile top bar (< lg) ── */}
      <div className="lg:hidden">
        <TopBar />
      </div>

      {/* ── Main content ── */}
      {/* Mobile: narrow centered column with bottom-nav padding            */}
      {/* Desktop: starts after 220px sidebar, wider content, no nav offset */}
      <main className="
        max-w-lg mx-auto px-4 pb-safe pt-2
        lg:max-w-none lg:mx-0 lg:px-10 lg:pt-8 lg:pb-12
        lg:app-main-desktop
      ">
        {/* Inner wrapper gives a sensible max width on large monitors */}
        <div className="lg:max-w-6xl lg:mx-auto">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav (< lg) ── */}
      <div className="lg:hidden">
        <BottomNav />
      </div>

      <FloatingActions />
      <AntiProcrastinationNudge />
    </div>
  )
}
