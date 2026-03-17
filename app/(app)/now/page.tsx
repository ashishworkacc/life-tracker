'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'

const FOCUS_PRESETS = [25, 30, 45, 60]
const SHORT_BREAK_PRESETS = [5, 10]
const LONG_BREAK_PRESETS = [15, 20]
const SESSIONS_BEFORE_LONG = 4
const LS_KEY = 'pomo_session'

interface PomoSession {
  endsAt: number       // wall-clock timestamp when timer ends (0 if paused)
  phase: Phase
  taskText: string
  focusMins: number
  sessionCount: number
  isPaused: boolean
  pausedSecondsLeft: number  // seconds left at time of pause
}

function savePomoToLS(s: Partial<PomoSession>) {
  const prev = loadPomoFromLS()
  localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...s }))
}
function loadPomoFromLS(): PomoSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function clearPomoLS() { localStorage.removeItem(LS_KEY) }

type Phase = 'select' | 'focus' | 'short-break' | 'long-break' | 'done'
type TaskTab = 'p1' | 'work' | 'habits' | 'counters'

interface PickableTask { id: string; title: string; type: TaskTab }
interface CompletedSession { taskText: string; durationMins: number; timestamp: string }

function playBeep(frequency = 440, duration = 0.6, volume = 0.3) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = frequency
    osc.type = 'sine'
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
    setTimeout(() => ctx.close(), (duration + 0.1) * 1000)
  } catch { /* browser may block audio without interaction */ }
}

export default function PomodoroPage() {
  const { user } = useAuth()
  const today = todayDate()

  // Settings
  const [focusMins, setFocusMins] = useState(25)
  const [shortBreakMins, setShortBreakMins] = useState(5)
  const [longBreakMins, setLongBreakMins] = useState(15)
  const [showSettings, setShowSettings] = useState(false)
  const [autoStartBreak, setAutoStartBreak] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)

  // Timer state
  const [phase, setPhase] = useState<Phase>('select')
  const [secondsLeft, setSecondsLeft] = useState(focusMins * 60)
  const [isPaused, setIsPaused] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)       // in current set of 4
  const [totalSessionsToday, setTotalSessionsToday] = useState(0)
  const [totalMinsToday, setTotalMinsToday] = useState(0)
  const [completedSessions, setCompletedSessions] = useState<CompletedSession[]>([])

  // Task picking
  const [taskTab, setTaskTab] = useState<TaskTab>('p1')
  const [p1Todos, setP1Todos] = useState<PickableTask[]>([])
  const [workTodos, setWorkTodos] = useState<PickableTask[]>([])
  const [habits, setHabits] = useState<PickableTask[]>([])
  const [counters, setCounters] = useState<PickableTask[]>([])
  const [selectedTask, setSelectedTask] = useState<PickableTask | null>(null)
  const [customTask, setCustomTask] = useState('')
  const [breakdowns, setBreakdowns] = useState<string[]>([])
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!user) return
    loadTasks()
    loadTodayStats()
  }, [user])

  // Restore in-progress session from localStorage on mount
  useEffect(() => {
    const stored = loadPomoFromLS()
    if (!stored || stored.phase === 'select' || stored.phase === 'done') return
    if (stored.isPaused) {
      setPhase(stored.phase); setSessionCount(stored.sessionCount ?? 0)
      setFocusMins(stored.focusMins); setIsPaused(true)
      setSecondsLeft(stored.pausedSecondsLeft)
      setSelectedTask({ id: 'restored', title: stored.taskText, type: 'p1' as const })
    } else if (stored.endsAt > Date.now()) {
      setPhase(stored.phase); setSessionCount(stored.sessionCount ?? 0)
      setFocusMins(stored.focusMins); setIsPaused(false)
      setSecondsLeft(Math.round((stored.endsAt - Date.now()) / 1000))
      setSelectedTask({ id: 'restored', title: stored.taskText, type: 'p1' as const })
    } else {
      // Timer already expired while away — treat as phase end
      clearPomoLS()
    }
  }, [])

  // Timer tick using wall-clock time so it works across tab switches
  useEffect(() => {
    if ((phase === 'focus' || phase === 'short-break' || phase === 'long-break') && !isPaused) {
      const stored = loadPomoFromLS()
      const endsAt = stored?.endsAt ?? 0
      if (endsAt <= 0) return
      intervalRef.current = setInterval(() => {
        const remaining = Math.round((endsAt - Date.now()) / 1000)
        if (remaining <= 0) {
          clearInterval(intervalRef.current!)
          setSecondsLeft(0)
          handlePhaseEnd()
        } else {
          setSecondsLeft(remaining)
        }
      }, 500)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [phase, isPaused])

  // Sync when tab becomes visible again
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible' || isPaused) return
      const stored = loadPomoFromLS()
      if (!stored || !stored.endsAt) return
      const remaining = Math.round((stored.endsAt - Date.now()) / 1000)
      if (remaining <= 0) { handlePhaseEnd() } else { setSecondsLeft(remaining) }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [isPaused])

  function handlePhaseEnd() {
    if (soundEnabled) playBeep(520, 0.8)

    if (phase === 'focus') {
      const newCount = sessionCount + 1
      setSessionCount(newCount % SESSIONS_BEFORE_LONG)
      setTotalSessionsToday(t => t + 1)
      setTotalMinsToday(m => m + focusMins)

      const isLongBreak = newCount % SESSIONS_BEFORE_LONG === 0
      if (autoStartBreak) {
        const breakMins = isLongBreak ? longBreakMins : shortBreakMins
        const nextPhase = isLongBreak ? 'long-break' : 'short-break'
        const endsAt = Date.now() + breakMins * 60 * 1000
        savePomoToLS({ phase: nextPhase as Phase, endsAt, isPaused: false, pausedSecondsLeft: 0 })
        setPhase(nextPhase)
        setSecondsLeft(breakMins * 60)
      } else {
        clearPomoLS()
        setPhase('done')
      }
    } else {
      // Break ended → back to select
      clearPomoLS()
      setPhase('select')
      setSecondsLeft(focusMins * 60)
      if (soundEnabled) setTimeout(() => playBeep(880, 0.4), 300)
    }
  }

  async function loadTasks() {
    if (!user) return
    // Load all incomplete todos then filter client-side to avoid complex composite indexes
    const [allTodos, habitDocs, counterDocs] = await Promise.all([
      queryDocuments('todos', [
        where('userId', '==', user.uid),
        where('completed', '==', false),
      ]),
      queryDocuments('habits', [
        where('userId', '==', user.uid),
        where('isActive', '==', true),
      ]),
      queryDocuments('custom_counters', [where('userId', '==', user.uid)]),
    ])
    setP1Todos(
      allTodos
        .filter(d => d.priority === 1 && (d.category === 'personal' || !d.category))
        .slice(0, 10)
        .map(d => ({ id: d.id, title: d.title, type: 'p1' as const }))
    )
    setWorkTodos(
      allTodos
        .filter(d => d.category === 'work')
        .slice(0, 10)
        .map(d => ({ id: d.id, title: d.title, type: 'work' as const }))
    )
    setHabits(habitDocs.map(d => ({ id: d.id, title: d.name, type: 'habits' as const })))
    setCounters(counterDocs.map(d => ({
      id: d.id,
      title: `${d.emoji ?? '🎯'} ${d.name} (${d.currentCount ?? 0}/${d.targetCount ?? 100})`,
      type: 'counters' as const,
    })))
  }

  async function loadTodayStats() {
    if (!user) return
    const docs = await queryDocuments('pomodoro_sessions', [
      where('userId', '==', user.uid),
      where('date', '==', today),
    ])
    setTotalSessionsToday(docs.length)
    setTotalMinsToday(docs.reduce((s, d) => s + (d.durationMins ?? 25), 0))
    setCompletedSessions(docs.slice(0, 8).map(d => ({
      taskText: d.taskText ?? 'Focus session',
      durationMins: d.durationMins ?? 25,
      timestamp: typeof d.timestamp === 'string' ? d.timestamp
        : (d.timestamp?.toDate?.()?.toISOString?.() ?? ''),
    })))
  }

  function startFocus(task: PickableTask | null) {
    const taskToStart = task ?? (customTask.trim() ? { id: 'custom', title: customTask.trim(), type: 'p1' as const } : null)
    if (!taskToStart) return
    const endsAt = Date.now() + focusMins * 60 * 1000
    savePomoToLS({ phase: 'focus', endsAt, taskText: taskToStart.title, focusMins, sessionCount, isPaused: false, pausedSecondsLeft: 0 })
    setSelectedTask(taskToStart)
    setPhase('focus')
    setSecondsLeft(focusMins * 60)
    setBreakdowns([])
    startTimeRef.current = Date.now()
    if (soundEnabled) playBeep(440, 0.3)
  }

  async function handleDone() {
    if (!user || !selectedTask) return
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 60000)
    const durationMins = Math.max(elapsed, 1)

    const doc = {
      userId: user.uid, date: today,
      taskText: selectedTask.title,
      durationMins,
      completed: true,
      timestamp: new Date().toISOString(),
    }
    await addDocument('pomodoro_sessions', doc)
    await addDocument('time_entries', {
      userId: user.uid, date: today,
      category: selectedTask.type === 'work' ? 'work' : 'personal',
      description: selectedTask.title, durationMins,
    })

    setCompletedSessions(prev => [{
      taskText: selectedTask.title,
      durationMins,
      timestamp: new Date().toISOString(),
    }, ...prev.slice(0, 7)])
    setTotalSessionsToday(t => t + 1)
    setTotalMinsToday(m => m + durationMins)

    if (soundEnabled) playBeep(660, 0.7)

    const newCount = sessionCount + 1
    setSessionCount(newCount % SESSIONS_BEFORE_LONG)

    if (autoStartBreak) {
      const isLong = newCount % SESSIONS_BEFORE_LONG === 0
      const breakMins = isLong ? longBreakMins : shortBreakMins
      const nextPhase = isLong ? 'long-break' : 'short-break'
      const endsAt = Date.now() + breakMins * 60 * 1000
      savePomoToLS({ phase: nextPhase as Phase, endsAt, isPaused: false, pausedSecondsLeft: 0 })
      setPhase(nextPhase)
      setSecondsLeft(breakMins * 60)
    } else {
      clearPomoLS()
      setPhase('done')
    }
  }

  function skipBreak() {
    clearInterval(intervalRef.current!)
    clearPomoLS()
    setPhase('select')
    setSecondsLeft(focusMins * 60)
  }

  function cancelFocus() {
    clearInterval(intervalRef.current!)
    clearPomoLS()
    setPhase('select')
    setSecondsLeft(focusMins * 60)
    setSelectedTask(null)
  }

  async function getBreakdown() {
    if (!user || !selectedTask) return
    setLoadingBreakdown(true)
    try {
      const res = await fetch('/api/ai/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: selectedTask.title, userId: user.uid }),
      })
      const data = await res.json()
      if (data.steps) setBreakdowns(data.steps)
    } catch {
      setBreakdowns(['Open the file/app', 'Write the first line', 'Review progress', 'Save and close'])
    }
    setLoadingBreakdown(false)
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const activeTask = selectedTask?.title ?? customTask
  const tabItems: PickableTask[] = taskTab === 'p1' ? p1Todos : taskTab === 'work' ? workTodos : taskTab === 'habits' ? habits : counters

  const isBreak = phase === 'short-break' || phase === 'long-break'
  const totalSecs = phase === 'focus' ? focusMins * 60 : phase === 'short-break' ? shortBreakMins * 60 : longBreakMins * 60
  const progressPct = totalSecs > 0 ? ((totalSecs - secondsLeft) / totalSecs) * 100 : 0
  const circumference = 2 * Math.PI * 88

  const phaseColor = phase === 'focus' ? '#14b8a6' : phase === 'short-break' ? '#22c55e' : '#818cf8'
  const phaseLabel = phase === 'focus' ? 'Focus' : phase === 'short-break' ? 'Short Break' : phase === 'long-break' ? 'Long Break ☕' : ''

  // Session dots (0–3 in current set of 4)
  const sessionDots = Array.from({ length: SESSIONS_BEFORE_LONG }, (_, i) => i < sessionCount)

  // ── DONE screen ──
  if (phase === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-5 animate-fade-in">
        <div className="text-7xl">🎉</div>
        <h2 className="text-2xl font-bold">Session complete!</h2>
        <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{totalSessionsToday}</p>
            <p className="text-xs text-muted">Sessions today</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold" style={{ color: '#a855f7' }}>{totalMinsToday}m</p>
            <p className="text-xs text-muted">Focused today</p>
          </div>
        </div>
        <p className="text-sm text-muted px-4">"{activeTask}"</p>
        <button onClick={() => { setPhase('select'); setSelectedTask(null); setCustomTask('') }}
          className="w-full max-w-xs py-4 rounded-2xl font-semibold"
          style={{ background: '#14b8a6', color: 'white' }}>
          ▶ Start next session
        </button>
      </div>
    )
  }

  // ── FOCUS / BREAK timer screen ──
  if (phase === 'focus' || isBreak) {
    return (
      <div className="flex flex-col items-center pt-4 pb-8 text-center space-y-5 animate-fade-in">
        {/* Phase label */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full"
            style={{ background: `${phaseColor}20`, color: phaseColor }}>
            {phaseLabel}
          </span>
          {phase === 'focus' && (
            <span className="text-xs text-muted">Session {sessionCount + 1}</span>
          )}
        </div>

        {/* Session dots */}
        <div className="flex items-center gap-2">
          {sessionDots.map((done, i) => (
            <div key={i} className="w-3 h-3 rounded-full transition-all"
              style={{ background: done ? phaseColor : 'var(--surface-2)', border: `2px solid ${done ? phaseColor : 'var(--border)'}` }} />
          ))}
          <span className="text-xs text-muted ml-1">/ {SESSIONS_BEFORE_LONG} → long break</span>
        </div>

        {/* Task chip */}
        {phase === 'focus' && activeTask && (
          <div className="px-4 py-2 rounded-xl max-w-xs"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-sm font-medium truncate">{activeTask}</p>
          </div>
        )}

        {isBreak && (
          <p className="text-sm text-muted">
            {phase === 'long-break' ? '☕ Long break — step away and rest.' : '🌿 Short break — breathe and stretch.'}
          </p>
        )}

        {/* Big ring timer */}
        <div className="relative" style={{ width: 220, height: 220 }}>
          <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
            <circle cx="110" cy="110" r="88" fill="none" strokeWidth="10" stroke="var(--surface-2)" />
            <circle cx="110" cy="110" r="88" fill="none" strokeWidth="10"
              stroke={phaseColor}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progressPct / 100)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-5xl font-mono font-bold">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
            <span className="text-xs text-muted">{Math.round(progressPct)}% done</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-3 w-full max-w-xs">
          <button
            onClick={() => {
              const next = !isPaused
              setIsPaused(next)
              if (next) {
                // Pausing: save seconds remaining, clear endsAt
                savePomoToLS({ isPaused: true, pausedSecondsLeft: secondsLeft, endsAt: 0 })
              } else {
                // Resuming: recalculate endsAt from now
                const endsAt = Date.now() + secondsLeft * 1000
                savePomoToLS({ isPaused: false, endsAt, pausedSecondsLeft: 0 })
              }
            }}
            className="flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          {phase === 'focus' ? (
            <button onClick={handleDone}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: phaseColor, color: 'white' }}>
              Done ✓
            </button>
          ) : (
            <button onClick={skipBreak}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: phaseColor, color: 'white' }}>
              Skip break →
            </button>
          )}
        </div>
        <button onClick={cancelFocus}
          className="text-xs text-muted py-1">✕ Cancel session</button>

        {/* I'm stuck */}
        {phase === 'focus' && (
          <div className="w-full max-w-xs">
            <button onClick={getBreakdown} disabled={loadingBreakdown}
              className="w-full py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {loadingBreakdown ? '🤔 Breaking it down...' : "😰 I'm stuck — break it down"}
            </button>
            {breakdowns.length > 0 && (
              <div className="mt-3 space-y-2 text-left">
                {breakdowns.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="text-xs font-bold text-muted w-4">{i + 1}.</span>
                    <p className="text-sm flex-1">{step}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── SELECT screen ──
  const TABS: { key: TaskTab; label: string; color: string }[] = [
    { key: 'p1', label: '🔴 P1', color: '#ef4444' },
    { key: 'work', label: '💼 Work', color: '#f59e0b' },
    { key: 'habits', label: '✅ Habits', color: '#22c55e' },
    { key: 'counters', label: '🔢 Count', color: '#818cf8' },
  ]

  return (
    <div className="pb-6 space-y-4 animate-fade-in">

      {/* ── Stats bar ── */}
      {(totalSessionsToday > 0 || completedSessions.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{totalSessionsToday}</p>
            <p className="text-xs text-muted">Sessions today</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold" style={{ color: '#a855f7' }}>
              {totalMinsToday >= 60 ? `${Math.floor(totalMinsToday / 60)}h ${totalMinsToday % 60}m` : `${totalMinsToday}m`}
            </p>
            <p className="text-xs text-muted">Focus time today</p>
          </div>
        </div>
      )}

      {/* ── Session dots progress ── */}
      {sessionCount > 0 && (
        <div className="flex items-center justify-center gap-2 py-2">
          {sessionDots.map((done, i) => (
            <div key={i} className="w-4 h-4 rounded-full"
              style={{ background: done ? '#14b8a6' : 'var(--surface-2)', border: `2px solid ${done ? '#14b8a6' : 'var(--border)'}` }} />
          ))}
          <span className="text-xs text-muted ml-1">
            {sessionCount}/{SESSIONS_BEFORE_LONG} · {SESSIONS_BEFORE_LONG - sessionCount} until long break
          </span>
        </div>
      )}

      {/* ── Timer display (non-active) ── */}
      <div className="card text-center space-y-3">
        <div className="text-5xl font-mono font-bold" style={{ color: '#14b8a6' }}>
          {String(focusMins).padStart(2, '0')}:00
        </div>
        <p className="text-xs text-muted">Focus session duration</p>

        {/* Duration presets */}
        <div>
          <p className="text-[10px] text-muted uppercase mb-1.5 font-semibold">Focus duration</p>
          <div className="flex gap-2 justify-center">
            {FOCUS_PRESETS.map(m => (
              <button key={m} onClick={() => setFocusMins(m)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: focusMins === m ? 'rgba(20,184,166,0.15)' : 'var(--surface-2)',
                  border: focusMins === m ? '1px solid #14b8a6' : '1px solid var(--border)',
                  color: focusMins === m ? '#14b8a6' : 'var(--muted)',
                }}>{m}m</button>
            ))}
          </div>
        </div>

        {/* Break presets */}
        <div className="flex gap-4 justify-center">
          <div>
            <p className="text-[10px] text-muted mb-1 font-semibold">Short break</p>
            <div className="flex gap-1">
              {SHORT_BREAK_PRESETS.map(m => (
                <button key={m} onClick={() => setShortBreakMins(m)}
                  className="px-2 py-1 rounded-lg text-xs"
                  style={{
                    background: shortBreakMins === m ? 'rgba(34,197,94,0.15)' : 'var(--surface-2)',
                    border: shortBreakMins === m ? '1px solid #22c55e' : '1px solid var(--border)',
                    color: shortBreakMins === m ? '#22c55e' : 'var(--muted)',
                  }}>{m}m</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted mb-1 font-semibold">Long break</p>
            <div className="flex gap-1">
              {LONG_BREAK_PRESETS.map(m => (
                <button key={m} onClick={() => setLongBreakMins(m)}
                  className="px-2 py-1 rounded-lg text-xs"
                  style={{
                    background: longBreakMins === m ? 'rgba(129,140,248,0.15)' : 'var(--surface-2)',
                    border: longBreakMins === m ? '1px solid #818cf8' : '1px solid var(--border)',
                    color: longBreakMins === m ? '#818cf8' : 'var(--muted)',
                  }}>{m}m</button>
              ))}
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center justify-center gap-4 pt-1">
          <button onClick={() => setAutoStartBreak(v => !v)}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: autoStartBreak ? '#14b8a6' : 'var(--muted)' }}>
            <span className="w-4 h-4 rounded flex items-center justify-center text-[10px]"
              style={{ background: autoStartBreak ? '#14b8a6' : 'var(--surface-2)', border: `1px solid ${autoStartBreak ? '#14b8a6' : 'var(--border)'}`, color: 'white' }}>
              {autoStartBreak ? '✓' : ''}
            </span>
            Auto-start break
          </button>
          <button onClick={() => setSoundEnabled(v => !v)}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: soundEnabled ? '#14b8a6' : 'var(--muted)' }}>
            <span className="w-4 h-4 rounded flex items-center justify-center text-[10px]"
              style={{ background: soundEnabled ? '#14b8a6' : 'var(--surface-2)', border: `1px solid ${soundEnabled ? '#14b8a6' : 'var(--border)'}`, color: 'white' }}>
              {soundEnabled ? '✓' : ''}
            </span>
            Sound {soundEnabled ? '🔔' : '🔕'}
          </button>
        </div>
      </div>

      {/* ── Task selector ── */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-sm">🎯 What will you focus on?</h3>

        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTaskTab(tab.key)}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: taskTab === tab.key ? 'var(--background)' : 'transparent',
                color: taskTab === tab.key ? tab.color : 'var(--muted)',
                boxShadow: taskTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {tabItems.length === 0 ? (
          <p className="text-sm text-muted text-center py-3">No items in this category</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {tabItems.map(t => (
              <button key={t.id} onClick={() => startFocus(t)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all active:scale-98"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: TABS.find(tab => tab.key === taskTab)?.color ?? '#14b8a6' }} />
                <span className="text-sm flex-1 truncate">{t.title}</span>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#14b8a6' }}>▶ Start</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Custom task ── */}
      <div className="card space-y-3">
        <p className="text-xs text-muted uppercase font-semibold">Or type a custom task</p>
        <input type="text" value={customTask} onChange={e => setCustomTask(e.target.value)}
          placeholder="What are you working on right now?"
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          onKeyDown={e => e.key === 'Enter' && startFocus(null)} />
        <button onClick={() => startFocus(null)} disabled={!customTask.trim()}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: '#14b8a6', color: 'white' }}>
          ▶ Start {focusMins}-min Focus
        </button>
      </div>

      {/* ── Today's sessions ── */}
      {completedSessions.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-sm mb-3">✅ Today&apos;s Sessions</h3>
          <div className="space-y-2">
            {completedSessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--surface-2)' }}>
                <span className="text-lg">🍅</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{s.taskText}</p>
                  {s.timestamp && (
                    <p className="text-xs text-muted">
                      {new Date(s.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  )}
                </div>
                <span className="text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                  {s.durationMins}m
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
