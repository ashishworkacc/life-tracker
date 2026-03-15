import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'
import { SYSTEM_PROMPTS } from '@/lib/ai/prompts'
import { checkRateLimit, rateLimitResponse } from '@/lib/ai/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const { task, userId } = await req.json()
    if (!task) return NextResponse.json({ error: 'No task provided' }, { status: 400 })
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { allowed } = checkRateLimit(userId)
    if (!allowed) return rateLimitResponse()

    const result = await aiComplete(
      SYSTEM_PROMPTS.taskBreakdown,
      `Break down this task: "${task}"`
    )

    // Parse JSON array from response
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    const steps = jsonMatch ? JSON.parse(jsonMatch[0]) : [
      'Open the task', 'Start with the first line', 'Complete the core action', 'Review and finish'
    ]

    return NextResponse.json({ steps })
  } catch (err) {
    console.error('Breakdown API error:', err)
    return NextResponse.json({
      steps: ['Open the task', 'Write one sentence', 'Take the smallest next step', 'Save your progress']
    })
  }
}
