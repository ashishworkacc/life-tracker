import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Lazy initialization — Firebase is only initialized when a getter is called.
// This prevents module-level initialization during SSR/prerender where env vars are empty.
let _app: FirebaseApp | null = null
let _auth: Auth | null = null
let _db: Firestore | null = null

function app(): FirebaseApp {
  if (!_app) {
    _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
  }
  return _app
}

export function firebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(app())
  }
  return _auth
}

export function firebaseDb(): Firestore {
  if (!_db) {
    _db = getFirestore(app())
  }
  return _db
}

// FCM messaging — browser only
export async function getFirebaseMessaging() {
  if (typeof window === 'undefined') return null
  const { getMessaging, isSupported } = await import('firebase/messaging')
  const supported = await isSupported()
  if (!supported) return null
  return getMessaging(app())
}
