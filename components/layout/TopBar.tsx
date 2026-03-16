'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useDarkMode } from '@/lib/hooks/useDarkMode'

const PAGE_TITLES: Record<string, string> = {
  '/command-center':       '⚡ Today',
  '/dashboard':            '📊 Dashboard',
  '/goals':                '🎯 Goals',
  '/habits':               '✅ Habits',
  '/trackers':             '📈 Trackers',
  '/trackers/sleep':       '😴 Sleep',
  '/trackers/weight':      '⚖️ Weight',
  '/trackers/food':        '🥗 Food Log',
  '/trackers/screen-time': '📱 Screen Time',
  '/trackers/books':       '📚 Books',
  '/trackers/vitals':      '💊 Medications',
  '/trackers/custom':      '📊 Custom Trackers',
  '/counters':             '🔢 Counters',
  '/todos':                '📋 Todos',
  '/time-tracker':         '⏱️ Time',
  '/ai-insights':          '🤖 AI Insights',
  '/chat':                 '💬 AI Chat',
  '/journal':              '📓 Journal',
  '/focus':                '🍅 Focus',
  '/inbox':                '📥 Inbox',
  '/now':                  '🎯 Now',
  '/gamification':         '🏆 Achievements',
  '/settings':             '⚙️ Settings',
}

const MAIN_ROUTES = ['/command-center']

interface TopBarProps {
  inboxCount?: number
  xpToday?: number
  level?: number
}

export default function TopBar({ inboxCount = 0, xpToday = 0, level = 1 }: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { isDark, toggle } = useDarkMode()

  const title = Object.entries(PAGE_TITLES)
    .filter(([key]) => pathname === key || pathname.startsWith(key + '/'))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? 'LifeTracker'

  const isMainRoute = MAIN_ROUTES.some(r => pathname === r)
  const showBack = !isMainRoute

  return (
    <header
      className="sticky top-0 z-30 safe-top"
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="flex items-center justify-between px-4 h-14 max-w-lg mx-auto">
        {/* Left: back button or spacer */}
        <div style={{ minWidth: 56 }}>
          {showBack && (
            <button onClick={() => router.push('/command-center')}
              className="flex items-center gap-1 text-sm font-medium py-1 rounded-lg"
              style={{ color: '#14b8a6' }}
              aria-label="Go to Today">
              ← Today
            </button>
          )}
        </div>

        {/* Page title - centered */}
        <h1 className="text-base font-semibold absolute left-1/2 -translate-x-1/2">{title}</h1>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* XP / Level pill */}
          <Link href="/gamification">
            <span className="text-xs font-medium px-2 py-1 rounded-full"
              style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
              Lv{level} · +{xpToday} XP
            </span>
          </Link>

          {/* Inbox badge */}
          {inboxCount > 0 && (
            <Link href="/inbox" className="relative">
              <span className="text-lg">📥</span>
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: '#ef4444', color: 'white' }}>
                {inboxCount > 9 ? '9+' : inboxCount}
              </span>
            </Link>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={toggle}
            className="text-xl p-1 rounded-lg transition-colors"
            aria-label="Toggle dark mode"
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </header>
  )
}
