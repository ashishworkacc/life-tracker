import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'
import { SYSTEM_PROMPTS } from '@/lib/ai/prompts'
import { checkRateLimit, rateLimitResponse } from '@/lib/ai/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const { todos, goals, energy, userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { allowed } = checkRateLimit(userId)
    if (!allowed) return rateLimitResponse()

    const userPrompt = `Energy level: ${energy}/5
Active goals: ${goals?.join(', ') || 'None'}
Todo list:
${todos.map((t: { id: string; title: string; priority: number }) => `- ID: ${t.id} | "${t.title}" | Current priority: P${t.priority}`).join('\n')}

Re-classify each todo as P1/P2/P3.`

    const result = await aiComplete(SYSTEM_PROMPTS.todoTriage, userPrompt)
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    const triaged = jsonMatch ? JSON.parse(jsonMatch[0]) : []

    return NextResponse.json({ triaged })
  } catch (err) {
    console.error('Triage API error:', err)
    return NextResponse.json({ triaged: [] })
  }
}
