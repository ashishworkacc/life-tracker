'use client'

import Link from 'next/link'

const trackers = [
  { href: '/trackers/sleep', icon: '😴', label: 'Sleep', desc: 'Log bedtime & wake time', color: '#818cf8' },
  { href: '/trackers/weight', icon: '⚖️', label: 'Weight', desc: 'Track your daily weight', color: '#f59e0b' },
  { href: '/trackers/food', icon: '🍽️', label: 'Food Log', desc: 'Meals, macros & calories', color: '#22c55e' },
  { href: '/trackers/screen-time', icon: '📱', label: 'Screen Time', desc: 'Daily phone usage', color: '#ef4444' },
  { href: '/trackers/books', icon: '📚', label: 'Books', desc: 'Reading tracker & progress', color: '#14b8a6' },
  { href: '/trackers/vitals', icon: '💊', label: 'Vitals & Meds', desc: 'Custom daily vitals', color: '#a855f7' },
]

export default function TrackersPage() {
  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      <p className="text-sm text-muted">Select a tracker to log your daily data.</p>

      <div className="grid grid-cols-2 gap-3">
        {trackers.map(t => (
          <Link key={t.href} href={t.href}
            className="card flex flex-col items-center text-center gap-2 py-5 transition-opacity active:opacity-70">
            <span className="text-4xl">{t.icon}</span>
            <span className="font-semibold text-sm">{t.label}</span>
            <span className="text-xs text-muted">{t.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
