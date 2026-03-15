import { NextRequest, NextResponse } from 'next/server'

// Simple rate limit: check Authorization header for Firebase ID token presence
// In production, verify the token with Firebase Admin SDK
// For now, we ensure only authenticated clients (with a token) can call AI routes

const DAILY_LIMIT = 30 // max AI calls per day per user
const callCounts = new Map<string, { count: number; resetAt: number }>()

export function getCallerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  // Also accept userId in body (for existing client code)
  return null
}

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = callCounts.get(userId)

  if (!entry || now > entry.resetAt) {
    // Reset: new day window (resets every 24h from first call)
    callCounts.set(userId, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 })
    return { allowed: true, remaining: DAILY_LIMIT - 1 }
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  entry.count++
  return { allowed: true, remaining: DAILY_LIMIT - entry.count }
}

export function rateLimitResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Daily AI limit reached. Try again tomorrow.' },
    { status: 429 }
  )
}
