'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, todayDate } from '@/lib/firebase/db'

interface Props {
  open: boolean
  onClose: () => void
}

const FIVE_MINUTES = 5 * 60

export default function OverwhelmPanicOverlay({ open, onClose }: Props) {
  const { user } = useAuth()
  const [task, setTask] = useState('')
  const [timerActive, setTimerActive] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(FIVE_MINUTES)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerActive && secondsLeft > 0) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft(s => s - 1)
      }, 1000)
    } else if (secondsLeft === 0) {
      setTimerActive(false)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [timerActive, secondsLeft])

  function startTimer() {
    if (!task.trim()) return
    setTimerActive(true)
    setSecondsLeft(FIVE_MINUTES)
  }

  function addFiveMore() {
    setSecondsLeft(s => s + FIVE_MINUTES)
    setTimerActive(true)
  }

  async function handleDone() {
    if (user && task) {
      await addDocument('overwhelm_sessions', {
        userId: user.uid,
        date: todayDate(),
        taskText: task,
        durationMins: Math.round((FIVE_MINUTES - secondsLeft) / 60),
      })
    }
    setTask('')
    setTimerActive(false)
    setSecondsLeft(FIVE_MINUTES)
    onClose()
  }

  if (!open) return null

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6"
      style={{ background: 'var(--background)' }}>

      <button onClick={onClose} className="absolute top-5 right-5 text-2xl text-muted">✕</button>

      <div className="w-full max-w-sm text-center animate-fade-in">
        <div className="text-5xl mb-4">😰</div>
        <h2 className="text-xl font-bold mb-2">Feeling overwhelmed?</h2>
        <p className="text-sm text-muted mb-6">
          Pick just ONE thing to do in the next 5 minutes. That's it.
        </p>

        {!timerActive ? (
          <>
            <input
              type="text"
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="What's the smallest thing you can do right now?"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              autoFocus
            />
            <button
              onClick={startTimer}
              disabled={!task.trim()}
              className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}
            >
              Start 5-minute timer
            </button>
          </>
        ) : (
          <div>
            <div className="text-6xl font-mono font-bold mb-2" style={{ color: '#14b8a6' }}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
            <p className="text-sm text-muted mb-2">Working on:</p>
            <p className="font-medium mb-8">"{task}"</p>

            {secondsLeft === 0 && (
              <p className="text-sm mb-4" style={{ color: '#22c55e' }}>
                ✓ Time's up! Great job showing up.
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={addFiveMore}
                className="flex-1 py-3 rounded-xl font-medium text-sm"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
              >
                5 more mins
              </button>
              <button
                onClick={handleDone}
                className="flex-1 py-3 rounded-xl font-semibold text-sm"
                style={{ background: '#14b8a6', color: 'white' }}
              >
                Done ✓
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
