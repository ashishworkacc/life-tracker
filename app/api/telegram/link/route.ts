import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

// Server-side endpoint to write telegram_links/{chatId} using Admin SDK.
// Called from the Settings page after the user saves their Chat ID.
export async function POST(req: NextRequest) {
  let body: { userId: string; chatId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, chatId } = body
  if (!userId || !chatId) {
    return NextResponse.json({ error: 'Missing userId or chatId' }, { status: 400 })
  }

  const db = adminDb()

  // Write the link document keyed by chatId
  await db.collection('telegram_links').doc(String(chatId)).set({
    userId,
    chatId: String(chatId),
    linkedAt: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}

// Allow removing the link when user disconnects
export async function DELETE(req: NextRequest) {
  let body: { chatId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { chatId } = body
  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })
  }

  const db = adminDb()
  await db.collection('telegram_links').doc(String(chatId)).delete()

  return NextResponse.json({ ok: true })
}
