import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!

async function sendMessage(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// Returns the previous 30-min slot label (e.g. "14:00" or "14:30")
function prevSlot(): string {
  const now = new Date()
  const totalMins = now.getHours() * 60 + now.getMinutes()
  const slotMins = totalMins - (totalMins % 30)
  const h = String(Math.floor(slotMins / 60)).padStart(2, '0')
  const m = slotMins % 60 === 0 ? '00' : '30'
  return `${h}:${m}`
}

function todayDateStr(): string {
  return new Date().toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  // Vercel automatically validates CRON_SECRET for cron routes
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const hour = now.getHours()

  // Only send between 7am and 11pm
  if (hour < 7 || hour >= 23) {
    return NextResponse.json({ skipped: 'outside active hours' })
  }

  const slot = prevSlot()
  const date = todayDateStr()
  const db = adminDb()

  // Get all linked users
  const linksSnap = await db.collection('telegram_links').get()
  if (linksSnap.empty) {
    return NextResponse.json({ sent: 0 })
  }

  let sent = 0

  await Promise.all(
    linksSnap.docs.map(async (linkDoc) => {
      const { userId, chatId } = linkDoc.data() as { userId: string; chatId: string }

      // Check if this slot already has an entry
      const docId = `${userId}_${date}`
      const ledgerDoc = await db.collection('time_ledger').doc(docId).get()
      const blocks = ledgerDoc.exists ? (ledgerDoc.data()?.blocks ?? {}) : {}

      if (blocks[slot]?.entry) {
        // Slot already filled — skip
        return
      }

      await sendMessage(
        chatId,
        `🕐 ${slot} — What were you working on?\n\nReply here to update your Time Ledger (or ignore to skip).`,
      )
      sent++
    }),
  )

  return NextResponse.json({ sent, slot, date })
}
