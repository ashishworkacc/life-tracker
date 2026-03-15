'use client'

import Link from 'next/link'

interface Props {
  open: boolean
  onClose: () => void
}

const NAV_SECTIONS = [
  { href: '/now',          icon: '🍅', label: 'Pomodoro' },
  { href: '/focus',        icon: '🔥', label: 'Focus' },
  { href: '/journal',      icon: '📓', label: 'Journal' },
  { href: '/trackers',     icon: '📈', label: 'Trackers' },
  { href: '/goals',        icon: '🎯', label: 'Goals' },
  { href: '/dashboard',    icon: '📊', label: 'Stats' },
  { href: '/ai-insights',  icon: '🤖', label: 'AI Insights' },
  { href: '/chat',         icon: '💬', label: 'AI Chat' },
  { href: '/time-tracker', icon: '⏱️', label: 'Time' },
  { href: '/gamification', icon: '🏆', label: 'Achievements' },
  { href: '/settings',     icon: '⚙️', label: 'Settings' },
]

export default function NavDrawer({ open, onClose }: Props) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl p-5 max-w-lg mx-auto"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} />
        <p className="text-xs text-muted font-medium mb-3 uppercase tracking-wide">All Sections</p>
        <div className="grid grid-cols-4 gap-2">
          {NAV_SECTIONS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl transition-colors active:scale-95"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-[10px] font-medium text-center leading-tight" style={{ color: 'var(--muted)' }}>
                {item.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
