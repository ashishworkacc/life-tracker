import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (!name) return NextResponse.json({ emoji: '🎯' })

    const result = await aiComplete(
      'You are an emoji selector. Given a habit name, reply with ONLY a single most fitting emoji character. No explanation, no punctuation, just the emoji.',
      `Habit: "${name}"`
    )

    const emoji = result.trim().slice(0, 2) || '🎯'
    return NextResponse.json({ emoji })
  } catch {
    return NextResponse.json({ emoji: '🎯' })
  }
}
