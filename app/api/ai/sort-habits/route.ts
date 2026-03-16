import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { habits, timeOfDay, doneIds } = await req.json()

    const habitList = habits.map((h: {
      id: string; name: string; scheduledTime: string
      completionRate7d: number; currentStreak: number; priority: number; why?: string
    }) =>
      `id=${h.id} | "${h.name}" | scheduled=${h.scheduledTime} | rate=${h.completionRate7d}% | streak=${h.currentStreak}d | priority=P${h.priority}`
    ).join('\n')

    const doneList = doneIds?.length ? `Already done today: ${doneIds.join(', ')}` : 'None done yet today'

    const prompt = `Current time of day: ${timeOfDay}
${doneList}

HABITS (not yet done today):
${habitList}

Sort these habits into the optimal order the user should do them in RIGHT NOW.

Rules:
1. Morning habits first if it's morning, evening habits last
2. High-streak habits near top (losing a streak is costly)
3. P1 habits before P2/P3
4. Low completion rate habits early (when energy/motivation is higher)
5. "anytime" habits fill gaps naturally

Return ONLY a JSON array of the habit IDs in the optimal order.
Example: ["id1","id2","id3"]
Return ONLY the JSON array, no other text.`

    const result = await aiComplete(
      'You are a habit scheduling AI. You output only valid JSON arrays of habit IDs.',
      prompt
    )

    const jsonMatch = result.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) throw new Error('No JSON array')
    const sortedIds = JSON.parse(jsonMatch[0]) as string[]
    return NextResponse.json({ sortedIds })
  } catch (err) {
    console.error('sort-habits error:', err)
    // Return original order on failure
    const { habits } = await req.json().catch(() => ({ habits: [] }))
    return NextResponse.json({ sortedIds: (habits ?? []).map((h: { id: string }) => h.id) })
  }
}
