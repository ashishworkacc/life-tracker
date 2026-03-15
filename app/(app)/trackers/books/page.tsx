'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { addDocument, queryDocuments, updateDocument, deleteDocument, todayDate, where, orderBy } from '@/lib/firebase/db'

interface Book {
  id: string
  title: string
  author?: string
  totalPages: number
  pagesRead: number
  status: 'reading' | 'completed' | 'planned'
  startedAt?: string
  completedAt?: string
}

export default function BooksTrackerPage() {
  const { user } = useAuth()
  const today = todayDate()

  const [books, setBooks] = useState<Book[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingBook, setEditingBook] = useState<Book | null>(null)

  // Add form
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [totalPages, setTotalPages] = useState('')
  const [saving, setSaving] = useState(false)

  // Pages update
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [newPages, setNewPages] = useState('')

  useEffect(() => {
    if (!user) return
    loadBooks()
  }, [user])

  async function loadBooks() {
    if (!user) return
    const docs = await queryDocuments('books', [
      where('userId', '==', user.uid),
    ])
    setBooks(docs.map(d => ({
      id: d.id, title: d.title, author: d.author,
      totalPages: d.totalPages ?? 0, pagesRead: d.pagesRead ?? 0,
      status: d.status ?? 'reading', startedAt: d.startedAt, completedAt: d.completedAt,
    })).sort((a, b) => {
      const order: Record<string, number> = { reading: 0, planned: 1, completed: 2 }
      return (order[a.status] ?? 0) - (order[b.status] ?? 0)
    }))
    setLoading(false)
  }

  async function addBook() {
    if (!user || !title.trim()) return
    setSaving(true)
    await addDocument('books', {
      userId: user.uid, title: title.trim(), author: author.trim() || null,
      totalPages: parseInt(totalPages) || 0, pagesRead: 0,
      status: 'reading', startedAt: today,
    })
    setTitle(''); setAuthor(''); setTotalPages('')
    setShowAdd(false); setSaving(false)
    await loadBooks()
  }

  async function saveBookEdit() {
    if (!user || !editingBook) return
    await updateDocument('books', editingBook.id, {
      title: editingBook.title, author: editingBook.author || null,
      totalPages: editingBook.totalPages,
    })
    setBooks(prev => prev.map(b => b.id === editingBook.id ? { ...b, ...editingBook } : b))
    setEditingBook(null)
  }

  async function updatePages(book: Book) {
    if (!user || !newPages) return
    const pages = parseInt(newPages)
    const isComplete = book.totalPages > 0 && pages >= book.totalPages
    await updateDocument('books', book.id, {
      pagesRead: pages,
      status: isComplete ? 'completed' : 'reading',
      completedAt: isComplete ? today : null,
    })
    setUpdatingId(null); setNewPages('')
    await loadBooks()
  }

  async function deleteBook(id: string) {
    await deleteDocument('books', id)
    setBooks(prev => prev.filter(b => b.id !== id))
    setMenuId(null)
  }

  const reading = books.filter(b => b.status === 'reading')
  const completed = books.filter(b => b.status === 'completed')
  const totalPagesRead = books.reduce((s, b) => s + b.pagesRead, 0)

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted">Loading...</p></div>

  // Edit book form
  if (editingBook) {
    return (
      <div className="pb-4 space-y-4 animate-fade-in">
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">Edit Book</h3>
          <input type="text" value={editingBook.title}
            onChange={e => setEditingBook(b => b ? { ...b, title: e.target.value } : null)}
            placeholder="Title"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="text" value={editingBook.author ?? ''}
            onChange={e => setEditingBook(b => b ? { ...b, author: e.target.value } : null)}
            placeholder="Author (optional)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="number" value={editingBook.totalPages || ''}
            onChange={e => setEditingBook(b => b ? { ...b, totalPages: parseInt(e.target.value) || 0 } : null)}
            placeholder="Total pages"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div className="flex gap-2">
            <button onClick={() => setEditingBook(null)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={saveBookEdit} disabled={!editingBook.title.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>Save</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4 space-y-4 animate-fade-in">

      {/* Stats */}
      <div className="flex gap-3">
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{reading.length}</p>
          <p className="text-xs text-muted">Reading</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#22c55e' }}>{completed.length}</p>
          <p className="text-xs text-muted">Completed</p>
        </div>
        <div className="flex-1 card-sm text-center">
          <p className="text-2xl font-bold" style={{ color: '#818cf8' }}>{totalPagesRead.toLocaleString()}</p>
          <p className="text-xs text-muted">Pages read</p>
        </div>
      </div>

      {/* Add book */}
      {showAdd ? (
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">Add Book</h3>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Book title" autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="text" value={author} onChange={e => setAuthor(e.target.value)}
            placeholder="Author (optional)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <input type="number" value={totalPages} onChange={e => setTotalPages(e.target.value)}
            placeholder="Total pages"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)}
              className="flex-1 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={addBook} disabled={!title.trim() || saving}
              className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: '#14b8a6', color: 'white' }}>{saving ? '...' : 'Add Book'}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          style={{ background: 'var(--surface)', border: '2px dashed var(--border)', color: 'var(--muted)' }}>
          <span className="text-lg">+</span> Add book
        </button>
      )}

      {/* Currently reading */}
      {reading.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">📖 Currently Reading</h3>
          <div className="space-y-3">
            {reading.map(book => {
              const pct = book.totalPages > 0 ? Math.min((book.pagesRead / book.totalPages) * 100, 100) : 0
              return (
                <div key={book.id} className="card">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{book.title}</p>
                      {book.author && <p className="text-xs text-muted">{book.author}</p>}
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      <span className="text-xs font-bold" style={{ color: '#14b8a6' }}>
                        {book.pagesRead}{book.totalPages > 0 ? `/${book.totalPages}` : ''} pg
                      </span>
                      <button onClick={() => setMenuId(menuId === book.id ? null : book.id)}
                        className="text-muted text-sm px-1">⋯</button>
                    </div>
                  </div>
                  {book.totalPages > 0 && (
                    <div className="w-full rounded-full h-2 mb-2 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#14b8a6' }} />
                    </div>
                  )}
                  {menuId === book.id && (
                    <div className="flex gap-2 mb-2 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                      <button onClick={() => { setEditingBook(book); setMenuId(null) }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>✏️ Edit</button>
                      <button onClick={() => deleteBook(book.id)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>🗑️ Delete</button>
                    </div>
                  )}
                  {updatingId === book.id ? (
                    <div className="flex gap-2 mt-2">
                      <input type="number" value={newPages} onChange={e => setNewPages(e.target.value)}
                        placeholder="Total pages read so far" autoFocus
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' }} />
                      <button onClick={() => updatePages(book)}
                        className="px-3 py-2 rounded-lg text-sm font-semibold"
                        style={{ background: '#14b8a6', color: 'white' }}>Save</button>
                      <button onClick={() => setUpdatingId(null)} className="px-2 py-2 text-muted text-sm">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => { setUpdatingId(book.id); setNewPages(String(book.pagesRead)) }}
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: 'rgba(20,184,166,0.1)', color: '#14b8a6' }}>
                      Update progress
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">✅ Completed ({completed.length})</h3>
          <div className="space-y-2">
            {completed.map(book => (
              <div key={book.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-xl">📗</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{book.title}</p>
                  <p className="text-xs text-muted">{book.pagesRead} pages · {book.completedAt}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingBook(book)}
                    className="text-xs px-1.5 py-1 rounded" style={{ color: 'var(--muted)' }}>✏️</button>
                  <button onClick={() => deleteBook(book.id)}
                    className="text-xs px-1.5 py-1 rounded" style={{ color: '#ef4444' }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {books.length === 0 && (
        <div className="text-center py-10">
          <p className="text-4xl mb-3">📚</p>
          <p className="text-sm text-muted">Add your first book to start tracking</p>
        </div>
      )}
    </div>
  )
}
