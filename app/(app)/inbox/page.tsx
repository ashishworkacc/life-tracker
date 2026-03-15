'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface InboxItem {
  id: string
  text: string
  capturedAt: string
  processed: boolean
}

export default function InboxPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [items, setItems] = useState<InboxItem[]>([])
  const [newText, setNewText] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    loadInbox()
  }, [user])

  async function loadInbox() {
    if (!user) return
    const docs = await queryDocuments('inbox', [
      where('userId', '==', user.uid),
      where('processed', '==', false),
      orderBy('capturedAt', 'desc'),
    ])
    setItems(docs.map(d => ({
      id: d.id,
      text: d.text,
      capturedAt: d.capturedAt,
      processed: d.processed ?? false,
    })))
    setLoading(false)
  }

  async function capture() {
    if (!user || !newText.trim()) return
    setAdding(true)
    await addDocument('inbox', {
      userId: user.uid,
      text: newText.trim(),
      capturedAt: new Date().toISOString(),
      processed: false,
    })
    setNewText('')
    setAdding(false)
    await loadInbox()
  }

  async function makeTask(item: InboxItem) {
    if (!user) return
    setProcessingId(item.id)
    // Create a todo from this inbox item
    await addDocument('todos', {
      userId: user.uid,
      title: item.text,
      category: 'personal',
      priority: 2,
      completed: false,
      createdAt: new Date().toISOString(),
    })
    await updateDocument('inbox', item.id, {
      processed: true,
      processedAction: 'task',
    })
    setProcessingId(null)
    await loadInbox()
  }

  async function dismiss(item: InboxItem) {
    setProcessingId(item.id)
    await updateDocument('inbox', item.id, { processed: true, processedAction: 'dismissed' })
    setProcessingId(null)
    await loadInbox()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      <p className="text-xs text-muted">
        Capture anything on your mind. Process it — make it a task, schedule it, or dismiss it.
      </p>

      {/* Quick capture */}
      <div className="card space-y-3">
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="What's on your mind? Capture it here..."
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          onKeyDown={e => {
            if (e.key === 'Enter' && e.metaKey) capture()
          }}
        />
        <button onClick={capture} disabled={!newText.trim() || adding}
          className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          style={{ background: '#14b8a6', color: 'white' }}>
          {adding ? '...' : '📥 Capture'}
        </button>
      </div>

      {/* Inbox items */}
      {items.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-sm text-muted">Inbox zero! Everything processed.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{items.length} item{items.length !== 1 ? 's' : ''} to process</h3>
          </div>
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="card">
                <p className="text-sm mb-3">{item.text}</p>
                <p className="text-xs text-muted mb-3">
                  {new Date(item.capturedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => makeTask(item)}
                    disabled={processingId === item.id}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}
                  >
                    ✅ Make it a task
                  </button>
                  <button
                    onClick={() => dismiss(item)}
                    disabled={processingId === item.id}
                    className="flex-1 py-2 rounded-xl text-xs disabled:opacity-50"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    🗑️ Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
