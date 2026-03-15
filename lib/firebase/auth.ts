import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  updateProfile,
} from 'firebase/auth'
import { firebaseAuth } from './config'
import { createUserDoc } from './db'

const googleProvider = new GoogleAuthProvider()

export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(firebaseAuth(), email, password)
}

export async function signUpWithEmail(email: string, password: string, displayName: string) {
  const credential = await createUserWithEmailAndPassword(firebaseAuth(), email, password)
  await updateProfile(credential.user, { displayName })
  await createUserDoc(credential.user.uid, {
    email,
    displayName,
    plan: 'pro', // All features free at launch
    createdAt: new Date().toISOString(),
    settings: {
      darkMode: false,
      weekStartDay: 'monday',
      weeklyReflectionDay: 'sunday',
      graceModeEnabled: false,
      checkInsEnabled: false,
      workWindows: ['10:00-12:00', '15:00-17:00'],
      windDownTime: '21:30',
      quickAddHabits: [],
    },
    identityStatement: '',
    needsResetPrompt: false,
    notificationsEnabled: false,
  })
  return credential
}

export async function signInWithGoogle() {
  const credential = await signInWithPopup(firebaseAuth(), googleProvider)
  const user = credential.user
  // Create user doc if first time (upsert)
  await createUserDoc(user.uid, {
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    plan: 'pro',
    createdAt: new Date().toISOString(),
    settings: {
      darkMode: false,
      weekStartDay: 'monday',
      weeklyReflectionDay: 'sunday',
      graceModeEnabled: false,
      checkInsEnabled: false,
      workWindows: ['10:00-12:00', '15:00-17:00'],
      windDownTime: '21:30',
      quickAddHabits: [],
    },
    identityStatement: '',
    needsResetPrompt: false,
    notificationsEnabled: false,
  }, { merge: true })
  return credential
}

export async function signOut() {
  return firebaseSignOut(firebaseAuth())
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(firebaseAuth(), callback)
}
