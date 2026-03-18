import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { userId, date, habitsCompleted, todosCompleted, countersUpdated, xpEarned, activityLogs, foodSummary } = await req.json()

    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const habitLines = habitsCompleted?.length
      ? habitsCompleted.map((h: string) => `  ✅ ${h}`).join('\n')
      : '  • No habits logged today'

    const todoLines = todosCompleted?.length
      ? todosCompleted.map((t: string) => `  ✓ ${t}`).join('\n')
      : '  • No todos completed'

    const counterLines = countersUpdated?.length
      ? countersUpdated.map((c: { name: string; added: number; current: number; target: number }) =>
          `  • ${c.name}: +${c.added} (${c.current}/${c.target})`
        ).join('\n')
      : '  • No counter updates'

    const thoughtLines = activityLogs?.length
      ? activityLogs.map((t: string) => `  • "${t}"`).join('\n')
      : ''

    const foodLine = foodSummary
      ? `Food: ${foodSummary.calories} kcal, ${foodSummary.protein}g protein`
      : 'Food: not logged'

    const prompt = `Write a warm, personal daily summary for ${date}. Write in second person ("you"). 3-4 sentences max. Be specific — reference actual habits, todos, and data. End with one forward-looking sentence about tomorrow.

DATA:
Habits completed:
${habitLines}

Todos completed:
${todoLines}

Counter updates:
${counterLines}

${foodLine}
XP earned today: ${xpEarned ?? 0}

${thoughtLines ? `User's thoughts/notes:\n${thoughtLines}` : ''}

Rules:
- First sentence: highlight the biggest win of the day
- Second sentence: note one area that was missed or incomplete (if any)
- Third sentence: a specific observation about trend or pattern
- Final sentence: one concrete intention for tomorrow
- If everything went well, acknowledge it genuinely without being sycophantic
- Max 4 sentences, conversational tone`

    const result = await aiComplete(
      'You are a warm, honest personal journal assistant. You write personalized daily summaries that feel like they came from a thoughtful friend who knows the user\'s data. You\'re specific, never generic.',
      prompt
    )

    return NextResponse.json({ summary: result.trim() })
  } catch (err) {
    console.error('Daily summary error:', err)
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 })
  }
}
