'use client'

import { useState } from 'react'
import QuickAddDrawer from '@/components/command-center/QuickAddDrawer'
import OverwhelmPanicOverlay from '@/components/layout/OverwhelmPanicOverlay'

export default function FloatingActions() {
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [panicOpen, setPanicOpen] = useState(false)

  return (
    <>
      {/* Floating Quick-Add button */}
      <button
        onClick={() => setQuickAddOpen(true)}
        className="fixed right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-transform hover:scale-110 active:scale-95"
        style={{
          bottom: 'calc(4.5rem + env(safe-area-inset-bottom))',
          background: '#14b8a6',
          color: 'white',
        }}
        aria-label="Quick add"
      >
        +
      </button>

      {/* Overwhelm Panic Button */}
      <button
        onClick={() => setPanicOpen(true)}
        className="fixed left-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-transform hover:scale-110 active:scale-95"
        style={{
          bottom: 'calc(4.5rem + env(safe-area-inset-bottom))',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
        aria-label="Overwhelm panic button"
        title="Feeling overwhelmed?"
      >
        😰
      </button>

      <QuickAddDrawer open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <OverwhelmPanicOverlay open={panicOpen} onClose={() => setPanicOpen(false)} />
    </>
  )
}
