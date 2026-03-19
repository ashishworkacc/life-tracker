'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { queryDocuments, todayDate, where, orderBy, limit } from '@/lib/firebase/db'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const { user } = useAuth()

  type ThinkingMode = 'normal' | 'first-principles' | 'devils-advocate' | 'council'

  const THINKING_MODES: { key: ThinkingMode; label: string; emoji: string; color: string; desc: string }[] = [
    { key: 'normal', label: 'Normal', emoji: '💬', color: '#14b8a6', desc: 'Standard AI chat about your data and habits' },
    { key: 'first-principles', label: 'First Principles', emoji: '🔬', color: '#3b82f6', desc: 'Break down goals and problems to their fundamentals' },
    { key: 'devils-advocate', label: "Devil's Advocate", emoji: '😈', color: '#ef4444', desc: 'AI challenges your plans and assumptions' },
    { key: 'council', label: 'Council', emoji: '🏛️', color: '#8b5cf6', desc: 'Multiple expert perspectives debate your question' },
  ]

  const MODE_SYSTEM_PREFIX: Record<ThinkingMode, string> = {
    'normal': '',
    'first-principles': `THINKING MODE: First Principles.
When answering, break down the user's question or goal to its most fundamental truths. Question every assumption. Reason from the ground up rather than by analogy. Structure your answer as: 1) What are we really trying to achieve? 2) What do we know for certain? 3) What assumptions are we making? 4) What does first-principles reasoning reveal? Be rigorous and specific.`,
    'devils-advocate': `THINKING MODE: Devil's Advocate.
Your role is to constructively challenge the user's plans, goals, and assumptions. Don't just agree — find the weakest points in their reasoning, surface risks they haven't considered, and stress-test their ideas. Be honest and direct, not harsh. Structure: 1) Acknowledge the idea 2) Surface the key weaknesses 3) Pose 2-3 hard questions they should answer before proceeding.`,
    'council': `THINKING MODE: Council of Experts.
Respond as a council of 3 distinct expert personas debating the user's question. Each expert has a distinct lens. Format:
⚖️ The Pragmatist: [practical, what-works angle]
🎯 The Strategist: [long-term systems and second-order effects]
🔥 The Challenger: [contrarian, hardest questions]
End with: 🧭 Synthesis: [what the council agrees on and the recommended path forward]`,
  }

  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('normal')
  const [showModes, setShowModes] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m your LifeTracker AI. Ask me anything about your data, habits, goals, or how to improve.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!user) return
    buildContext()
  }, [user])

  async function buildContext() {
    if (!user) return
    const today = todayDate()

    const [summaries, habits, goals, counters] = await Promise.all([
      queryDocuments('daily_summaries', [
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        limit(7),
      ]),
      queryDocuments('habits', [
        where('userId', '==', user.uid),
        where('isActive', '==', true),
      ]),
      queryDocuments('goals', [
        where('userId', '==', user.uid),
        where('status', '==', 'active'),
      ]),
      queryDocuments('custom_counters', [
        where('userId', '==', user.uid),
      ]),
    ])

    const ctx = `User data summary (last 7 days):
${JSON.stringify(summaries, null, 2)}

Active habits: ${habits.map((h: any) => h.name).join(', ')}
Active goals: ${goals.map((g: any) => g.title).join(', ')}
Custom counters: ${counters.map((c: any) => `${c.name}: ${c.currentCount}/${c.targetCount}`).join(', ')}`

    setContext(ctx)
  }

  async function sendMessage() {
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const modePrefix = MODE_SYSTEM_PREFIX[thinkingMode]
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.slice(-10),
          context,
          userId: user?.uid,
          systemPrefix: modePrefix || undefined,
        })
      })

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      // Add empty assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        assistantContent += decoder.decode(value)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
          return updated
        })
      }
    } catch (err) {
      console.error('Chat error:', err)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I had trouble connecting. Please try again.'
      }])
    }

    setLoading(false)
    inputRef.current?.focus()
  }

  const suggestedQuestions = [
    'How was my sleep this week?',
    'Which habits am I most consistent with?',
    'What\'s my gym counter at?',
    'Give me a summary of my week',
  ]

  const currentMode = THINKING_MODES.find(m => m.key === thinkingMode)!

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Thinking mode selector */}
      <div className="mb-2">
        <button
          onClick={() => setShowModes(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: `${currentMode.color}15`, border: `1px solid ${currentMode.color}40`,
            borderRadius: 99, padding: '0.3rem 0.75rem', cursor: 'pointer',
            fontSize: '0.78rem', color: currentMode.color, fontWeight: 600,
          }}
        >
          <span>{currentMode.emoji}</span>
          <span>{currentMode.label}</span>
          <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>▼</span>
        </button>
        {showModes && (
          <div style={{
            marginTop: '0.35rem', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}>
            {THINKING_MODES.map(m => (
              <button key={m.key} onClick={() => { setThinkingMode(m.key); setShowModes(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                  padding: '0.6rem 0.85rem', background: thinkingMode === m.key ? `${m.color}12` : 'transparent',
                  border: 'none', borderLeft: thinkingMode === m.key ? `3px solid ${m.color}` : '3px solid transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{m.emoji}</span>
                <div>
                  <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: m.color }}>{m.label}</p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <span className="text-xl mr-2 flex-shrink-0 mt-1">🤖</span>
            )}
            <div
              className="max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
              style={{
                background: msg.role === 'user' ? '#14b8a6' : 'var(--surface)',
                color: msg.role === 'user' ? 'white' : 'var(--foreground)',
                border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              }}
            >
              {msg.content || (loading && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}

        {/* Suggested questions (when only 1 message) */}
        {messages.length === 1 && (
          <div className="space-y-2 px-2">
            <p className="text-xs text-muted">Try asking:</p>
            {suggestedQuestions.map((q, i) => (
              <button key={i} onClick={() => { setInput(q); inputRef.current?.focus() }}
                className="w-full text-left px-3 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about your data..."
          className="flex-1 px-4 py-2.5 rounded-2xl text-sm outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        />
        <button onClick={sendMessage} disabled={!input.trim() || loading}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition-all"
          style={{ background: '#14b8a6', color: 'white' }}>
          {loading ? '...' : '↑'}
        </button>
      </div>
    </div>
  )
}
