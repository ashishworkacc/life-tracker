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

// Today's date in IST
function todayIST(): string {
  return toIST().toISOString().split('T')[0]
}

// Yesterday's date in IST (for the 3:30am daily report — the day that just ended)
function yesterdayIST(): string {
  const ist = toIST()
  ist.setUTCDate(ist.getUTCDate() - 1)
  return ist.toISOString().split('T')[0]
}

// Build and send the AI daily summary report
async function sendDailyReport(chatId: string, userId: string) {
  const db = adminDb()
  const date = yesterdayIST()
  const docId = `${userId}_${date}`
  const ledgerDoc = await db.collection('time_ledger').doc(docId).get()

  if (!ledgerDoc.exists) {
    await sendMessage(chatId, `📊 Daily Report — ${date}\n\nNo Time Ledger data found for yesterday. Start logging your day to see insights here!`)
    return
  }

  const data = ledgerDoc.data() ?? {}
  const blocks: Record<string, { entry?: string; classification?: string | null }> = data.blocks ?? {}
  const verdict: string = data.verdict ?? ''
  const status: string = data.status ?? ''
  const mediocreScore: number = data.mediocreScore ?? 0

  // Count classifications
  const counts: Record<string, number> = {}
  let filledCount = 0
  let totalCount = 0

  for (const slot of Object.values(blocks)) {
    totalCount++
    if (slot.entry) {
      filledCount++
      const cls = slot.classification ?? 'Unclassified'
      counts[cls] = (counts[cls] ?? 0) + 1
    }
  }

  // Format classification breakdown
  const classOrder = ['Deep Work', 'Admin', 'Personal', 'Workout', 'Break', 'Sleep', 'Unclassified']
  const classLines = classOrder
    .filter((c) => counts[c])
    .map((c) => `  • ${c}: ${counts[c] * 0.5}h`)
  // Also include any unexpected classifications
  for (const [c, n] of Object.entries(counts)) {
    if (!classOrder.includes(c)) classLines.push(`  • ${c}: ${n * 0.5}h`)
  }

  const coveragePct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0

  // Score emoji
  const scoreEmoji = mediocreScore >= 70 ? '🟢' : mediocreScore >= 40 ? '🟡' : '🔴'

  let report = `📊 Daily Report — ${date}\n`
  report += `${'─'.repeat(28)}\n`

  if (status) report += `Status: ${status}\n`
  if (mediocreScore) report += `${scoreEmoji} Focus Score: ${mediocreScore}%\n`
  report += `📋 Logged: ${filledCount}/${totalCount} blocks (${coveragePct}%)\n`

  if (classLines.length > 0) {
    report += `\n⏱ Time Breakdown:\n${classLines.join('\n')}\n`
  }

  if (verdict) {
    report += `\n💬 ${verdict}\n`
  }

  report += `\n— Life Tracker`

  await sendMessage(chatId, report)
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const istHour = toIST().getUTCHours()
  const slot = currentSlotIST()
  const date = todayIST()
  const db = adminDb()

  // Get all linked users
  const linksSnap = await db.collection('telegram_links').get()
  if (linksSnap.empty) {
    return NextResponse.json({ sent: 0, slot, date })
  }

  // 3:30 AM IST — send the daily report for the day that just ended
  if (slot === '03:30') {
    await Promise.all(
      linksSnap.docs.map(async (linkDoc) => {
        const { userId, chatId } = linkDoc.data() as { userId: string; chatId: string }
        await sendDailyReport(chatId, userId)
      }),
    )
    return NextResponse.json({ sent: linksSnap.size, slot, date, type: 'daily-report' })
  }

  // Active hours: 10am–3am IST (wrap-around). Skip 3am–10am IST.
  if (istHour >= 3 && istHour < 10) {
    return NextResponse.json({ skipped: 'outside active hours (IST 10am–3am)' })
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
