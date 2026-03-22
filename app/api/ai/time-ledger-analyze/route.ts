import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { blocks } = await req.json() as {
      blocks: { slot: string; entry: string }[]
    }

    if (!blocks || blocks.length === 0) {
      return NextResponse.json({ error: 'No blocks provided' }, { status: 400 })
    }

    const blockList = blocks
      .map(b => `${b.slot}: "${b.entry}"`)
      .join('\n')

    const systemPrompt = `You are a ruthlessly honest high-performance coach analyzing how someone spent their time.

For each 30-minute block, classify the activity as exactly one of:
- "high-yield": Deep work, focused exercise, learning, meaningful creation, strategic thinking, quality relationships
- "maintenance": Necessary but not growth-producing (meals, hygiene, commute, routine admin, sleep)
- "mediocre": Time wastage, passive consumption, low-value distraction (scrolling social media, mindless browsing, aimless procrastination, idle chatter, binge-watching without intent)

Be BLUNT and HONEST. "Watching Netflix" is mediocre. "Planning next week" is high-yield. "Eating lunch" is maintenance.

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "results": [
    {"slot": "HH:MM", "classification": "high-yield"|"maintenance"|"mediocre", "note": "brief 1-line reason"}
  ],
  "mediocreCount": number,
  "highYieldCount": number,
  "totalBlocks": number,
  "mediocreScore": number (0-100, percentage of mediocre blocks),
  "status": "on-fire"|"solid"|"mediocre",
  "verdict": "one sentence harsh but fair overall day verdict"
}`

    const userPrompt = `Classify these time blocks:\n${blockList}`

    const raw = await aiComplete(systemPrompt, userPrompt, { temperature: 0.3, maxTokens: 1200 })

    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error('Time ledger analyze error:', e)
    return NextResponse.json({ error: e?.message ?? 'Analysis failed' }, { status: 500 })
  }
}
