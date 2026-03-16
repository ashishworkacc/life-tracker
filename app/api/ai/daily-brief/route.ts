import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const {
      habits, todos, energy, sleep, focusSessions, timeOfDay, date,
      weeklyHabitPct, xpLevel, xpToday, todoStats, topCounters,
    } = await req.json()

    const counterLines = topCounters?.length
      ? topCounters.map((c: { name: string; currentCount: number; targetCount: number }) =>
          `  • ${c.name}: ${c.currentCount}/${c.targetCount} (${Math.round((c.currentCount / Math.max(c.targetCount, 1)) * 100)}%)`
        ).join('\n')
      : '  • No counters set up'

    const prompt = `Today is ${date}. It is ${timeOfDay}.

TODAY:
- Habits done: ${habits?.done ?? 0}/${habits?.total ?? 0}
- P1 Todos pending: ${todos?.p1Pending ?? 0}, completed today: ${todos?.completedToday ?? 0}
- Personal todos open: ${todoStats?.personal ?? 0}, Work todos open: ${todoStats?.work ?? 0}
- Sleep last night: ${sleep ?? 'not logged'} hours
- Focus (Pomodoro) sessions: ${focusSessions ?? 0}
- Energy level: ${energy ?? 'not logged'}/5
- XP earned today: ${xpToday ?? 0}, Current level: ${xpLevel ?? 1}

THIS WEEK:
- Average habit completion: ${weeklyHabitPct != null ? weeklyHabitPct + '%' : 'not enough data'}

COUNTERS PROGRESS:
${counterLines}

Write a 3–4 sentence motivational brief with these parts:
1. One honest sentence about how today and this week are going based on actual numbers.
2. One insight about what the data pattern suggests (trend, habit consistency, counter pace, etc.).
3. One specific, actionable recommendation for what to do next or focus on.
Be warm, direct, and specific — never generic. Use actual numbers from the data.`

    const result = await aiComplete(
      'You are a personal productivity coach. Write concise, data-driven, motivational messages. Be specific, warm, and honest. Never use filler phrases.',
      prompt
    )

    return NextResponse.json({ brief: result.trim() })
  } catch (err) {
    console.error('Daily brief API error:', err)
    return NextResponse.json({ brief: "You're building momentum — keep going. Focus on your top priority next." })
  }
}
