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

// IST = UTC+5:30. Time Ledger slots are keyed in the user's local time (IST).
function toIST(): Date {
  const now = new Date()
  return new Date(now.getTime() + 330 * 60 * 1000) // +330 min
}

// Current 30-min slot in IST — matches Time Ledger block keys
function currentSlotIST(): string {
  const ist = toIST()
  const h = ist.getUTCHours()
  const m = ist.getUTCMinutes()
  const slotMins = h * 60 + m - ((h * 60 + m) % 30)
  const sh = String(Math.floor(slotMins / 60)).padStart(2, '0')
  const sm = slotMins % 60 === 0 ? '00' : '30'
  return `${sh}:${sm}`
}

// Today's date in IST (day may differ from UTC around midnight)
function todayIST(): string {
  return toIST().toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Active hours check in IST (7am–11pm)
  const istHour = toIST().getUTCHours()
  if (istHour < 7 || istHour >= 23) {
    return NextResponse.json({ skipped: 'outside active hours (IST)' })
  }

  const slot = currentSlotIST()
  const date = todayIST()
  const db = adminDb()

  // Get all linked users
  const linksSnap = await db.collection('telegram_links').get()
  if (linksSnap.empty) {
    return NextResponse.json({ sent: 0, slot, date })
  }

  let sent = 0

  await Promise.all(
    linksSnap.docs.map(async (linkDoc) => {
      const { userId, chatId } = linkDoc.data() as { userId: string; chatId: string }

      // Check if this IST slot already has an entry
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
