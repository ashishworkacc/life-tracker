import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
  })
}

export function adminDb() {
  return getFirestore(getAdminApp())
}
