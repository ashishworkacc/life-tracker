import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { habits, todos, dueTodos, counters, timeOfDay, focusDone, habitsDone, habitsTotal } = await req.json()

    const habitLines = habits?.length
      ? habits.map((h: { name: string; priority: number; scheduledTime: string; completionRate7d: number; done: boolean }) =>
          `  ${h.done ? '✓' : '○'} [P${h.priority}] ${h.name} (${h.scheduledTime}, ${h.completionRate7d}% this week)`
        ).join('\n')
      : '  None'

    const todoLines = todos?.length
      ? todos.map((t: { title: string; priority: number; category: string; dueToday?: boolean }) =>
          `  [P${t.priority}] ${t.title} (${t.category}${t.dueToday ? ' — DUE TODAY' : ''})`
        ).join('\n')
      : '  None'

    const counterLines = counters?.length
      ? counters.map((c: { name: string; currentCount: number; targetCount: number }) => {
          const pct = Math.round((c.currentCount / Math.max(c.targetCount, 1)) * 100)
          const gap = c.targetCount - c.currentCount
          return `  ${c.name}: ${c.currentCount}/${c.targetCount} (${pct}%) — ${gap > 0 ? `${gap} to go` : 'COMPLETE'}`
        }).join('\n')
      : '  None'

    const prompt = `Time of day: ${timeOfDay}
Habits: ${habitsDone}/${habitsTotal} done today
Focus sessions completed today: ${focusDone ?? 0}

PENDING HABITS (not done today):
${habitLines}

OPEN TODOS (P1 and due today prioritised):
${todoLines}

COUNTER GOALS:
${counterLines}

Based on this data, recommend exactly 5 specific next actions the user should do RIGHT NOW.
Each action must be concrete (not vague), tied to actual data above, and ordered by urgency + impact.

Respond ONLY as a valid JSON array of exactly 5 objects. Each object must have:
- "title": short action (max 8 words)
- "type": one of "habit", "todo", "counter", "focus"
- "reason": ONE specific sentence saying why this matters now (mention actual numbers/names)
- "urgency": "high" | "medium" | "low"

Example format:
[{"title":"Complete morning run habit","type":"habit","reason":"Your 5-day streak breaks tonight if you skip.","urgency":"high"}]

Return ONLY the JSON array, no other text.`

    const result = await aiComplete(
      'You are a personal productivity AI. You output only valid JSON. You never add explanation text outside the JSON array.',
      prompt
    )

    // Extract JSON array from response
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array found')

    const actions = JSON.parse(jsonMatch[0])
    return NextResponse.json({ actions: actions.slice(0, 5) })
  } catch (err) {
    console.error('next-actions error:', err)
    // Fallback with generic actions
    return NextResponse.json({
      actions: [
        { title: 'Complete your P1 priority task', type: 'todo', reason: 'High-priority tasks drive the most impact on your goals.', urgency: 'high' },
        { title: 'Do one habit now', type: 'habit', reason: 'Starting a habit in the morning sets momentum for the day.', urgency: 'high' },
        { title: 'Log a 25-min focus session', type: 'focus', reason: 'Deep work moves projects forward more than scattered effort.', urgency: 'medium' },
        { title: 'Update your counter goal', type: 'counter', reason: 'Consistent daily progress compounds over weeks.', urgency: 'medium' },
        { title: 'Review remaining todos', type: 'todo', reason: 'Clearing your inbox reduces mental load.', urgency: 'low' },
      ]
    })
  }
}
