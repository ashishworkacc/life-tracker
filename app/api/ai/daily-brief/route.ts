import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const {
      habits, todos, sleep, focusSessions, timeOfDay, date,
      weeklyHabitPct, xpLevel, xpToday, todoStats, topCounters,
    } = await req.json()

    const habitsDone = habits?.done ?? 0
    const habitsTotal = habits?.total ?? 0
    const habitRate = habitsTotal > 0 ? Math.round((habitsDone / habitsTotal) * 100) : 0
    const pendingPersonal = todoStats?.personal ?? 0
    const pendingWork = todoStats?.work ?? 0
    const totalPending = pendingPersonal + pendingWork

    const counterLines = topCounters?.length
      ? topCounters.map((c: { name: string; currentCount: number; targetCount: number }) => {
          const pct = Math.round((c.currentCount / Math.max(c.targetCount, 1)) * 100)
          return `  • ${c.name}: ${c.currentCount}/${c.targetCount} (${pct}%)`
        }).join('\n')
      : '  • No counters set up'

    // Build a situation descriptor for richer context
    const habitStatus = habitsDone === habitsTotal && habitsTotal > 0 ? 'ALL habits done'
      : habitRate >= 70 ? 'most habits done'
      : habitRate >= 40 ? 'some habits done'
      : habitsTotal > 0 ? 'few habits done'
      : 'no habits logged'

    const sleepStatus = sleep == null ? 'sleep not logged'
      : sleep >= 8 ? `well-rested (${sleep}h)`
      : sleep >= 6 ? `slightly under-rested (${sleep}h)`
      : `sleep-deprived (only ${sleep}h)`

    const focusStatus = focusSessions === 0 ? 'no focus sessions yet'
      : focusSessions === 1 ? '1 focus session done'
      : `${focusSessions} focus sessions done`

    const todoStatus = totalPending === 0 ? 'inbox clear'
      : `${pendingWork} work + ${pendingPersonal} personal tasks open`

    const prompt = `CONTEXT: It is ${timeOfDay} on ${date}. User is at XP Level ${xpLevel ?? 1} and earned ${xpToday ?? 0} XP today.

TODAY'S NUMBERS:
- Habits: ${habitsDone}/${habitsTotal} done (${habitRate}%) — ${habitStatus}
- Sleep last night: ${sleepStatus}
- Focus: ${focusStatus}
- Todos: ${todoStatus} (${todos?.p1Pending ?? 0} P1 still pending, completed ${todos?.completedToday ?? 0} today)

THIS WEEK:
- Habit completion avg: ${weeklyHabitPct != null ? weeklyHabitPct + '%' : 'not enough data yet'}

COUNTER GOALS:
${counterLines}

STRICT RULES FOR YOUR RESPONSE:
1. Start with a SPECIFIC observation using actual numbers (e.g. "You've knocked out 4/6 habits at ${habitRate}%…")
2. Identify ONE concrete trend or pattern from the data (not generic praise)
3. Give ONE specific action the user should take in the next hour based on what's missing
4. Max 3 sentences. Be direct and honest — if numbers are bad, say so with empathy.
5. NEVER use: "Great job!", "Keep it up!", "You're doing well", "Amazing", "Fantastic" or any other filler praise.
6. Use the user's actual numbers every time.`

    const result = await aiComplete(
      'You are a no-nonsense personal productivity coach. You give data-driven, honest, specific insights. You always reference exact numbers. You never use generic motivational filler.',
      prompt
    )

    return NextResponse.json({ brief: result.trim() })
  } catch (err) {
    console.error('Daily brief API error:', err)
    return NextResponse.json({ brief: "Check your top priority task — that's the highest-leverage action right now." })
  }
}
