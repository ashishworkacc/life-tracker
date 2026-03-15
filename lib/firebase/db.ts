import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  QueryConstraint,
  DocumentData,
  SetOptions,
  writeBatch,
} from 'firebase/firestore'
import { firebaseDb } from './config'
// Use firebaseDb() (lazy getter) instead of module-level db to avoid SSR init issues

// ─── Generic helpers ──────────────────────────────────────────────────────────

export async function createUserDoc(userId: string, data: DocumentData, options?: SetOptions) {
  const ref = doc(firebaseDb(), 'users', userId)
  if (options) {
    return setDoc(ref, data, options)
  }
  // Only create if it doesn't exist
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    return setDoc(ref, { ...data, userId })
  }
}

export async function getUserDoc(userId: string): Promise<DocumentData & { id: string } | null> {
  const snap = await getDoc(doc(firebaseDb(), 'users', userId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateUserDoc(userId: string, data: Partial<DocumentData>) {
  return updateDoc(doc(firebaseDb(), 'users', userId), data)
}

// Set a document with a known ID
export async function setDocument(
  collectionPath: string,
  docId: string,
  data: DocumentData,
  options?: SetOptions
) {
  const ref = doc(firebaseDb(), collectionPath, docId)
  return options ? setDoc(ref, data, options) : setDoc(ref, data)
}

// Add a document (auto-generated ID)
export async function addDocument(collectionPath: string, data: DocumentData) {
  return addDoc(collection(firebaseDb(), collectionPath), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

// Get a single document by ID
export async function getDocument(collectionPath: string, docId: string) {
  const snap = await getDoc(doc(firebaseDb(), collectionPath, docId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Update a document
export async function updateDocument(collectionPath: string, docId: string, data: Partial<DocumentData>) {
  return updateDoc(doc(firebaseDb(), collectionPath, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

// Delete a document
export async function deleteDocument(collectionPath: string, docId: string) {
  return deleteDoc(doc(firebaseDb(), collectionPath, docId))
}

// Query documents with constraints
export async function queryDocuments(
  collectionPath: string,
  constraints: QueryConstraint[]
): Promise<(DocumentData & { id: string })[]> {
  const q = query(collection(firebaseDb(), collectionPath), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Real-time listener on a query
export function subscribeToQuery(
  collectionPath: string,
  constraints: QueryConstraint[],
  callback: (data: (DocumentData & { id: string })[]) => void
) {
  const q = query(collection(firebaseDb(), collectionPath), ...constraints)
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// Real-time listener on a single document
export function subscribeToDocument(
  collectionPath: string,
  docId: string,
  callback: (data: (DocumentData & { id: string }) | null) => void
) {
  return onSnapshot(doc(firebaseDb(), collectionPath, docId), snap => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null)
  })
}

// Batch write helper
export function getBatch() {
  return writeBatch(firebaseDb())
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function todayDate(): string {
  return new Date().toISOString().split('T')[0] // "YYYY-MM-DD"
}

export function dateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { where, orderBy, firestoreLimit as limit, serverTimestamp, Timestamp, firebaseDb as db }
