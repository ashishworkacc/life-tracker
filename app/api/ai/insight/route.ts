import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'
import { SYSTEM_PROMPTS, buildDailyInsightPrompt } from '@/lib/ai/prompts'
import { checkRateLimit, rateLimitResponse } from '@/lib/ai/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const { type, data, userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { allowed } = checkRateLimit(userId)
    if (!allowed) return rateLimitResponse()

    let result = ''

    switch (type) {
      case 'daily':
        result = await aiComplete(SYSTEM_PROMPTS.dailyInsight, buildDailyInsightPrompt(data))
        break
      case 'morning':
        result = await aiComplete(SYSTEM_PROMPTS.morningBrief,
          `Today: ${data.date}. Sleep: ${data.sleepLastNight}h. Priority: ${data.todayPriority}. Counters: ${data.counterStatus}`)
        break
      case 'snapshot':
        result = await aiComplete(SYSTEM_PROMPTS.holisticSnapshot, JSON.stringify(data))
        break
      case 'food':
        result = await aiComplete(SYSTEM_PROMPTS.foodCommentary, JSON.stringify(data))
        break
      case 'counter-pace':
        result = await aiComplete(SYSTEM_PROMPTS.counterPaceInsight, JSON.stringify(data))
        break
      case 'counter-celebration':
        result = await aiComplete(SYSTEM_PROMPTS.counterCelebration, JSON.stringify(data))
        break
      case 'burnout':
        result = await aiComplete(SYSTEM_PROMPTS.burnoutPrediction, JSON.stringify(data))
        break
      case 'weight-plateau':
        result = await aiComplete(SYSTEM_PROMPTS.weightPlateau, JSON.stringify(data))
        break
      case 'sleep-anomaly':
        result = await aiComplete(SYSTEM_PROMPTS.sleepAnomaly, JSON.stringify(data))
        break
      case 'bad-habits':
        result = await aiComplete(
          'You are a behavioral change coach using Atomic Habits principles. Analyze patterns in bad habit logs. Be specific — reference actual entries — and give actionable advice.',
          typeof data === 'string' ? data : JSON.stringify(data)
        )
        break
      default:
        return NextResponse.json({ error: 'Unknown insight type' }, { status: 400 })
    }

    return NextResponse.json({ insight: result })
  } catch (err) {
    console.error('Insight API error:', err)
    return NextResponse.json({ error: 'AI unavailable' }, { status: 500 })
  }
}
