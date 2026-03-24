import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!

async function sendMessage(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// IST = UTC+5:30. Time Ledger slots are keyed in IST (matches the browser app).
function toIST(): Date {
  return new Date(Date.now() + 330 * 60 * 1000)
}

// Current 30-min slot in IST
function prevSlot(): string {
  const ist = toIST()
  const h = ist.getUTCHours()
  const m = ist.getUTCMinutes()
  const slotMins = h * 60 + m - ((h * 60 + m) % 30)
  const sh = String(Math.floor(slotMins / 60)).padStart(2, '0')
  const sm = slotMins % 60 === 0 ? '00' : '30'
  return `${sh}:${sm}`
}

// Today's date in IST
function todayDateStr(): string {
  return toIST().toISOString().split('T')[0]
}

export async function POST(req: NextRequest) {
  // Verify secret token header only when both sides have it configured
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && secret && secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const message = body?.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat?.id
  const text = message.text?.trim() ?? ''

  if (!chatId) return NextResponse.json({ ok: true })

  // Handle /start command
  if (text === '/start' || text.startsWith('/start ')) {
    await sendMessage(
      chatId,
      `👋 Welcome to Life Tracker!\n\nYour Chat ID is: <b>${chatId}</b>\n\nCopy this number and paste it into Life Tracker → Settings → Telegram Check-Ins to connect your account.`,
    )
    // Send as HTML parse mode
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `👋 Welcome to Life Tracker!\n\nYour Chat ID is: <code>${chatId}</code>\n\nCopy this number and paste it into Life Tracker → Settings → Telegram Check-Ins to connect your account.`,
        parse_mode: 'HTML',
      }),
    })
    return NextResponse.json({ ok: true })
  }

  // Regular message — look up user by chatId
  const db = adminDb()
  const linkDoc = await db.collection('telegram_links').doc(String(chatId)).get()

  if (!linkDoc.exists) {
    await sendMessage(
      chatId,
      `❌ Your Telegram isn't linked to a Life Tracker account yet.\n\nSend /start to get your Chat ID, then paste it in Settings.`,
    )
    return NextResponse.json({ ok: true })
  }

  const { userId } = linkDoc.data() as { userId: string }
  const date = todayDateStr()
  const slot = prevSlot()
  const docId = `${userId}_${date}`

  // Write to time_ledger with merge
  await db.collection('time_ledger').doc(docId).set(
    {
      userId,
      date,
      blocks: {
        [slot]: {
          entry: text,
          classification: null,
          note: 'via Telegram',
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
    },
    { merge: true },
  )

  await sendMessage(chatId, `✅ Logged for ${slot} — "${text}"`)

  return NextResponse.json({ ok: true })
}
