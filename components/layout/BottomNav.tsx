'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const PRIMARY_NAV = [
  { href: '/command-center', label: 'Today',   icon: '⚡' },
  { href: '/todos',          label: 'Todos',   icon: '📋' },
  { href: '/habits',         label: 'Habits',  icon: '✅' },
  { href: '/counters',       label: 'Count',   icon: '🔢' },
]

const MORE_SECTIONS = [
  { href: '/health',      icon: '🍎', label: 'Health' },
  { href: '/time-ledger', icon: '🕐', label: 'Time' },
  { href: '/now',         icon: '🍅', label: 'Focus' },
  { href: '/journal',     icon: '📓', label: 'Journal' },
  { href: '/cravings',    icon: '⚠️', label: 'Cravings' },
  { href: '/chat',        icon: '💬', label: 'AI Chat' },
  { href: '/life-os',     icon: '🧬', label: 'Life OS' },
  { href: '/trackers',  icon: '📈', label: 'Trackers' },
  { href: '/settings',  icon: '⚙️', label: 'Settings' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close panel when navigating
  useEffect(() => { setMoreOpen(false) }, [pathname])

  // Close on outside tap
  useEffect(() => {
    if (!moreOpen) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [moreOpen])

  const moreActive = MORE_SECTIONS.some(s => pathname === s.href || pathname.startsWith(s.href + '/'))

  return (
    <div ref={panelRef} className="fixed bottom-0 left-0 right-0 z-40 max-w-lg mx-auto"
      style={{ filter: 'drop-shadow(0 -2px 8px rgba(0,0,0,0.15))' }}>

      {/* Expanded "More" panel — slides up above nav bar */}
      {moreOpen && (
        <div className="rounded-t-2xl px-4 pt-4 pb-3 animate-slide-up"
          style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
          <div className="w-8 h-1 rounded-full mx-auto mb-3" style={{ background: 'var(--border)' }} />
          <div className="grid grid-cols-4 gap-2">
            {MORE_SECTIONS.map(item => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all active:scale-95"
                  style={{
                    background: active ? 'rgba(20,184,166,0.1)' : 'var(--surface-2)',
                    border: active ? '1px solid rgba(20,184,166,0.3)' : '1px solid var(--border)',
                  }}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-[10px] font-medium text-center leading-tight"
                    style={{ color: active ? '#14b8a6' : 'var(--muted)' }}>
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav style={{
        background: 'var(--surface)',
        borderTop: moreOpen ? 'none' : '1px solid var(--border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div className="flex items-center justify-around h-16 px-2">
          {PRIMARY_NAV.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-colors min-w-0"
                style={{ color: active ? '#14b8a6' : 'var(--muted)' }}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="text-[10px] font-medium truncate">{item.label}</span>
                {active && <span className="w-1 h-1 rounded-full" style={{ background: '#14b8a6' }} />}
              </Link>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className="flex flex-col items-center gap-0.5 py-1 px-2 rounded-xl transition-colors min-w-0"
            style={{ color: moreOpen || moreActive ? '#14b8a6' : 'var(--muted)' }}
          >
            <span className="text-xl" style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>☰</span>
            <span className="text-[10px] font-medium">More</span>
            {(moreActive && !moreOpen) && <span className="w-1 h-1 rounded-full" style={{ background: '#14b8a6' }} />}
          </button>
        </div>
      </nav>
    </div>
  )
}
