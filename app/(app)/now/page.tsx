'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'

const POMODORO_MINS = 25
const BREAK_MINS = 5

type TaskTab = 'p1' | 'work' | 'habits' | 'counters'

interface PickableTask {
  id: string
  title: string
  type: TaskTab
}

export default function NowModePage() {
  const { user } = useAuth()
  const today = todayDate()

  const [taskTab, setTaskTab] = useState<TaskTab>('p1')
  const [p1Todos, setP1Todos] = useState<PickableTask[]>([])
  const [workTodos, setWorkTodos] = useState<PickableTask[]>([])
  const [habits, setHabits] = useState<PickableTask[]>([])
  const [counters, setCounters] = useState<PickableTask[]>([])
  const [selectedTask, setSelectedTask] = useState<PickableTask | null>(null)
  const [customTask, setCustomTask] = useState('')
  const [phase, setPhase] = useState<'select' | 'focus' | 'break' | 'done'>('select')
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_MINS * 60)
  const [sessions, setSessions] = useState(0)
  const [breakdowns, setBreakdowns] = useState<string[]>([])
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!user) return
    loadTasks()
  }, [user])

  useEffect(() => {
    if (phase === 'focus' || phase === 'break') {
      intervalRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            clearInterval(intervalRef.current!)
            if (phase === 'focus') {
              setPhase('break')
              setSecondsLeft(BREAK_MINS * 60)
              setSessions(prev => prev + 1)
            } else {
              setPhase('select')
              setSecondsLeft(POMODORO_MINS * 60)
            }
            return 0
          }
          return s - 1
        })
      }, 1000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [phase])

  async function loadTasks() {
    if (!user) return
    const [p1Docs, workDocs, habitDocs, counterDocs] = await Promise.all([
      queryDocuments('todos', [
        where('userId', '==', user.uid),
        where('completed', '==', false),
        where('priority', '==', 1),
        where('category', '==', 'personal'),
        orderBy('createdAt', 'asc'),
        limit(10),
      ]),
      queryDocuments('todos', [
        where('userId', '==', user.uid),
        where('completed', '==', false),
        where('category', '==', 'work'),
        orderBy('createdAt', 'asc'),
        limit(10),
      ]),
      queryDocuments('habits', [
        where('userId', '==', user.uid),
        where('isActive', '==', true),
      ]),
      queryDocuments('custom_counters', [
        where('userId', '==', user.uid),
      ]),
    ])
    setP1Todos(p1Docs.map(d => ({ id: d.id, title: d.title, type: 'p1' as const })))
    setWorkTodos(workDocs.map(d => ({ id: d.id, title: d.title, type: 'work' as const })))
    setHabits(habitDocs.map(d => ({ id: d.id, title: d.name, type: 'habits' as const })))
    setCounters(counterDocs.map(d => ({
      id: d.id,
      title: `${d.emoji ?? '🎯'} ${d.name} (${d.currentCount ?? 0}/${d.targetCount ?? 100})`,
      type: 'counters' as const,
    })))
  }

  async function startFocus(task: PickableTask | null) {
    const taskToStart = task ?? (customTask.trim() ? { id: 'custom', title: customTask.trim(), type: 'p1' as const } : null)
    if (!taskToStart) return
    setSelectedTask(taskToStart)
    setPhase('focus')
    setSecondsLeft(POMODORO_MINS * 60)
    setBreakdowns([])
  }

  async function handleDone() {
    if (!user || !selectedTask) return
    await addDocument('pomodoro_sessions', {
      userId: user.uid,
      date: today,
      taskText: selectedTask.title,
      durationMins: sessions * POMODORO_MINS + Math.round((POMODORO_MINS * 60 - secondsLeft) / 60),
      completed: true,
      timestamp: new Date().toISOString(),
    })
    // Log time entry
    await addDocument('time_entries', {
      userId: user.uid,
      date: today,
      category: selectedTask.type === 'work' ? 'work' : 'personal',
      description: selectedTask.title,
      durationMins: sessions * POMODORO_MINS + POMODORO_MINS,
    })
    setPhase('done')
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
      setBreakdowns(['Open the file/app', 'Write the first line', 'Review what you have', 'Save and close'])
    }
    setLoadingBreakdown(false)
  }

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const activeTask = selectedTask?.title ?? customTask

  const TABS: { key: TaskTab; label: string }[] = [
    { key: 'p1', label: 'P1 Todos' },
    { key: 'work', label: 'Work' },
    { key: 'habits', label: 'Habits' },
    { key: 'counters', label: 'Counters' },
  ]

  const tabItems: PickableTask[] = taskTab === 'p1' ? p1Todos
    : taskTab === 'work' ? workTodos
    : taskTab === 'habits' ? habits
    : counters

  // Phase: done
  if (phase === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
        <div className="text-6xl animate-bounce">🎉</div>
        <h2 className="text-xl font-bold">Great work!</h2>
        <p className="text-muted text-sm">{sessions} Pomodoro{sessions !== 1 ? 's' : ''} completed</p>
        <p className="text-sm font-medium">{activeTask}</p>
        <button onClick={() => { setPhase('select'); setSelectedTask(null); setCustomTask(''); setSessions(0) }}
          className="w-full max-w-xs py-3 rounded-2xl font-semibold"
          style={{ background: '#14b8a6', color: 'white' }}>
          Start next task
        </button>
      </div>
    )
  }

  // Phase: focus or break
  if (phase === 'focus' || phase === 'break') {
    return (
      <div className="flex flex-col items-center min-h-[70vh] pt-6 text-center space-y-6">
        {phase === 'break' ? (
          <>
            <p className="text-2xl">☕ Break time!</p>
            <p className="text-sm text-muted">Rest. Breathe. You earned it.</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted uppercase tracking-widest font-medium">
              Session {sessions + 1} · Focus
            </p>
            <p className="text-sm font-medium px-4 py-2 rounded-xl max-w-xs"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              {activeTask}
            </p>
          </>
        )}

        {/* Timer */}
        <div className="relative" style={{ width: 200, height: 200 }}>
          <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90">
            <circle cx="100" cy="100" r="88" fill="none" strokeWidth="8" stroke="var(--surface-2)" />
            <circle cx="100" cy="100" r="88" fill="none" strokeWidth="8"
              stroke={phase === 'break' ? '#22c55e' : '#14b8a6'}
              strokeDasharray={`${2 * Math.PI * 88}`}
              strokeDashoffset={`${2 * Math.PI * 88 * (1 - secondsLeft / ((phase === 'focus' ? POMODORO_MINS : BREAK_MINS) * 60))}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-mono font-bold">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="flex gap-3 w-full max-w-xs">
          <button onClick={() => { clearInterval(intervalRef.current!); setPhase('select'); setSecondsLeft(POMODORO_MINS * 60) }}
            className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            Skip
          </button>
          {phase === 'focus' && (
            <button onClick={handleDone}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#14b8a6', color: 'white' }}>
              Done ✓
            </button>
          )}
        </div>

        {/* I'm Stuck */}
        {phase === 'focus' && (
          <div className="w-full max-w-xs">
            <button onClick={getBreakdown} disabled={loadingBreakdown}
              className="w-full py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {loadingBreakdown ? '🤔 Thinking...' : '😰 I\'m stuck — break it down'}
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

  // Phase: select
  return (
    <div className="pb-4 space-y-4 animate-fade-in">
      <div className="text-center py-4">
        <p className="text-4xl mb-2">🎯</p>
        <h2 className="font-semibold text-lg">What are you working on?</h2>
        <p className="text-sm text-muted">Pick a task or type one. Full focus, 25 minutes.</p>
      </div>

      {/* Task tabs */}
      <div className="card space-y-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setTaskTab(tab.key)}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: taskTab === tab.key ? 'var(--background)' : 'transparent',
                color: taskTab === tab.key ? '#14b8a6' : 'var(--muted)',
                boxShadow: taskTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {tabItems.length === 0 ? (
          <p className="text-sm text-muted text-center py-3">
            {taskTab === 'p1' ? 'No P1 personal todos' : taskTab === 'work' ? 'No work todos' : taskTab === 'habits' ? 'No active habits' : 'No counters'}
          </p>
        ) : (
          <div className="space-y-2">
            {tabItems.map(t => (
              <button key={t.id} onClick={() => startFocus(t)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all active:scale-98"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: taskTab === 'p1' ? '#ef4444' : taskTab === 'work' ? '#f59e0b' : taskTab === 'habits' ? '#22c55e' : '#818cf8' }} />
                <span className="text-sm flex-1">{t.title}</span>
                <span className="text-xs" style={{ color: '#14b8a6' }}>▶ Start</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom task */}
      <div className="card space-y-3">
        <h3 className="text-xs text-muted uppercase font-semibold">Or type a custom task</h3>
        <input type="text" value={customTask} onChange={e => setCustomTask(e.target.value)}
          placeholder="What are you working on right now?"
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          onKeyDown={e => e.key === 'Enter' && startFocus(null)} />
        <button onClick={() => startFocus(null)} disabled={!customTask.trim()}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: '#14b8a6', color: 'white' }}>
          ▶ Start 25-minute Pomodoro
        </button>
      </div>

      {/* Sessions today */}
      {sessions > 0 && (
        <p className="text-center text-xs text-muted">{sessions} session{sessions !== 1 ? 's' : ''} completed today</p>
      )}
    </div>
  )
}
