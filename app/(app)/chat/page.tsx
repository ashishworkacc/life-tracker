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
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.slice(-10), // last 10 messages for context
          context,
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

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
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
