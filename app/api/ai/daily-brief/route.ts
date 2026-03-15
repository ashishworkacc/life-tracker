import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { habits, todos, energy, sleep, focusSessions, timeOfDay, date } = await req.json()

    const prompt = `Today is ${date}. It is currently ${timeOfDay}.

User data:
- Habits done: ${habits?.done ?? 0}/${habits?.total ?? 0}
- P1 Todos pending: ${todos?.p1Pending ?? 0}, completed today: ${todos?.completedToday ?? 0}
- Energy level: ${energy ?? 'not logged'}/5
- Sleep last night: ${sleep ?? 'not logged'} hours
- Focus sessions today: ${focusSessions ?? 0} Pomodoros

Write a 2-3 sentence personal secretary message. Be warm, direct, and motivating.
Include: (1) a quick honest assessment of how the day is going, (2) one specific thing they should do next.
If it's morning, focus on the plan. If afternoon, assess momentum. If evening, focus on closing strong.
No generic advice. Be specific based on their actual numbers.`

    const result = await aiComplete(
      'You are a personal productivity secretary. Write concise, personalized, action-oriented messages. Never be generic.',
      prompt
    )

    return NextResponse.json({ brief: result.trim() })
  } catch (err) {
    console.error('Daily brief API error:', err)
    return NextResponse.json({ brief: "You're making progress — keep going. Focus on your top priority next." })
  }
}
