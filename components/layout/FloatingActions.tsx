'use client'

import { useState } from 'react'
import OverwhelmPanicOverlay from '@/components/layout/OverwhelmPanicOverlay'

export default function FloatingActions() {
  const [panicOpen, setPanicOpen] = useState(false)

  return (
    <>
      {/* Overwhelm Panic Button */}
      <button
        onClick={() => setPanicOpen(true)}
        className="fixed right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-transform hover:scale-110 active:scale-95 fab-bottom"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        aria-label="Overwhelm panic button"
        title="Feeling overwhelmed?"
      >
        😰
      </button>

      <OverwhelmPanicOverlay open={panicOpen} onClose={() => setPanicOpen(false)} />
    </>
  )
}
