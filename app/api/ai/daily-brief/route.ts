import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const {
      habits, todos, sleep, focusSessions, timeOfDay, date, dayOfWeek,
      weeklyHabitPct, xpLevel, xpToday, todoStats, topCounters,
      atRiskHabits, last3DayRates, activeGoalTitles, userThoughts,
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

    const trendLine = last3DayRates?.length === 3
      ? `Last 3 days habit rates: ${last3DayRates[0]}% → ${last3DayRates[1]}% → ${last3DayRates[2]}% (today)`
      : 'Not enough multi-day trend data yet'

    const atRiskLine = atRiskHabits?.length
      ? `AT-RISK habits not done yet: ${(atRiskHabits as string[]).join(', ')}`
      : 'No at-risk habits'

    const goalsLine = activeGoalTitles?.length
      ? `Active long-term goals: ${(activeGoalTitles as string[]).join('; ')}`
      : 'No long-term goals set'

    // Use a random seed phrase so AI varies its angle each call
    const angles = [
      'Focus on the trend over today\'s absolute numbers.',
      'Identify what\'s blocking the user from completing their remaining habits.',
      'Connect one pending habit to the long-term goals if possible.',
      'Highlight the most important single action to shift momentum right now.',
      'Assess whether the sleep data explains today\'s performance.',
      'Call out whether the user is ahead or behind their weekly average.',
    ]
    const angle = angles[Math.floor(Math.random() * angles.length)]

    const prompt = `CONTEXT: It is ${timeOfDay} on ${dayOfWeek ?? ''}, ${date}. XP Level ${xpLevel ?? 1}, earned ${xpToday ?? 0} XP today.

TODAY'S NUMBERS:
- Habits: ${habitsDone}/${habitsTotal} done (${habitRate}%) — ${habitStatus}
- Sleep: ${sleepStatus}
- Focus: ${focusStatus}
- Todos: ${todoStatus} (${todos?.p1Pending ?? 0} P1 pending, ${todos?.completedToday ?? 0} completed today)

TREND: ${trendLine}
WEEKLY AVG: ${weeklyHabitPct != null ? weeklyHabitPct + '%' : 'not enough data'}
${atRiskLine}

COUNTER GOALS:
${counterLines}

${goalsLine}

${userThoughts?.length ? `USER'S OWN THOUGHTS TODAY:\n${(userThoughts as string[]).map((t: string) => `  • "${t}"`).join('\n')}\n(Use these thoughts to personalise your coaching — reference what the user is thinking/feeling.)` : ''}

YOUR ANGLE TODAY: ${angle}

STRICT RULES:
1. Start with a SPECIFIC observation using actual numbers from this data.
2. Identify ONE concrete trend or pattern — not generic.
3. Give ONE specific action to take in the next hour based on what's missing or at-risk.
4. Max 3 sentences. Direct and honest — if numbers are bad, say so with empathy.
5. NEVER use filler: "Great job!", "Keep it up!", "Amazing", "Fantastic", "You're doing well".
6. Every sentence must reference at least one real number or named item from the data above.`

    const result = await aiComplete(
      'You are a no-nonsense personal productivity coach. You give data-driven, honest, specific insights. You always reference exact numbers and named items. You vary your angle each time — sometimes focus on trends, sometimes on blockers, sometimes on goals. You never use generic motivational filler.',
      prompt
    )

    return NextResponse.json({ brief: result.trim() })
  } catch (err) {
    console.error('Daily brief API error:', err)
    return NextResponse.json({ brief: "Check your top priority task — that's the highest-leverage action right now." })
  }
}
