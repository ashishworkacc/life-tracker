'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useDarkMode } from '@/lib/hooks/useDarkMode'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, where, todayDate } from '@/lib/firebase/db'
import { calcLevel } from '@/lib/xp'

const NAV_SECTIONS = [
  {
    items: [
      { href: '/command-center', icon: '⚡', label: 'Today' },
      { href: '/todos',          icon: '📋', label: 'Todos' },
      { href: '/habits',         icon: '✅', label: 'Habits' },
      { href: '/counters',       icon: '🔢', label: 'Counters' },
    ],
  },
  {
    label: 'Health',
    items: [
      { href: '/health',          icon: '🍎', label: 'Health Hub' },
      { href: '/trackers/food',   icon: '🥗', label: 'Food Log' },
      { href: '/trackers/vitals', icon: '💊', label: 'Vitals & Meds' },
      { href: '/cravings',        icon: '⚠️', label: 'Cravings' },
    ],
  },
  {
    label: 'Track',
    items: [
      { href: '/now',      icon: '🍅', label: 'Pomodoro' },
      { href: '/trackers', icon: '📈', label: 'All Trackers' },
      { href: '/journal',  icon: '📓', label: 'Journal' },
    ],
  },
  {
    label: 'AI',
    items: [
      { href: '/chat',        icon: '💬', label: 'AI Chat' },
      { href: '/ai-insights', icon: '🤖', label: 'AI Insights' },
    ],
  },
  {
    label: 'More',
    items: [
      { href: '/life-os',  icon: '🧬', label: 'Life OS' },
      { href: '/settings', icon: '⚙️', label: 'Settings' },
    ],
  },
]

interface XpData { level: number; xpToday: number }

export default function SideNav() {
  const pathname = usePathname()
  const { isDark, toggle } = useDarkMode()
  const { user } = useAuth()
  const [xp, setXp] = useState<XpData | null>(null)

  useEffect(() => {
    if (!user) return
    const date = todayDate()
    Promise.all([
      queryDocuments('user_xp',   [where('userId', '==', user.uid)]),
      queryDocuments('xp_events', [where('userId', '==', user.uid), where('date', '==', date)]),
    ]).then(([xpDocs, events]) => {
      const total = xpDocs[0]?.xpTotal ?? 0
      const todayXp = (events as any[]).reduce((s: number, e: { xpEarned?: number }) => s + (e.xpEarned ?? 0), 0)
      const level = calcLevel(total)
      setXp({ level, xpToday: todayXp })
    }).catch(() => {})
  }, [user])

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="px-5 py-5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold"
            style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>⚡</div>
          <div>
            <p className="text-sm font-bold leading-none" style={{ color: 'var(--foreground)' }}>LifeTracker</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>Your life, optimized</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {section.label && (
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--muted)' }}>
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: active ? 'rgba(20,184,166,0.1)' : 'transparent',
                      color: active ? '#14b8a6' : 'var(--muted)',
                    }}
                  >
                    <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {active && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: '#14b8a6' }} />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: XP + dark mode */}
      <div className="flex-shrink-0 px-3 py-3 space-y-1" style={{ borderTop: '1px solid var(--border)' }}>
        {xp && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-1"
            style={{ background: 'rgba(168,85,247,0.08)' }}>
            <span className="text-sm">🏆</span>
            <div>
              <p className="text-xs font-semibold" style={{ color: '#a855f7' }}>Level {xp.level}</p>
              {xp.xpToday > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--muted)' }}>+{xp.xpToday} XP today</p>
              )}
            </div>
          </div>
        )}
        <button
          onClick={toggle}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all"
          style={{ color: 'var(--muted)' }}
        >
          <span className="text-base w-5 text-center flex-shrink-0">{isDark ? '☀️' : '🌙'}</span>
          <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </div>
  )
}
