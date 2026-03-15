import { NextRequest, NextResponse } from 'next/server'
import { aiStream } from '@/lib/ai/client'
import { SYSTEM_PROMPTS } from '@/lib/ai/prompts'
import { checkRateLimit, rateLimitResponse } from '@/lib/ai/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const { messages, context, userId } = await req.json()
    if (!messages?.length) return NextResponse.json({ error: 'No messages' }, { status: 400 })
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { allowed } = checkRateLimit(userId)
    if (!allowed) return rateLimitResponse()

    const systemPrompt = context
      ? `${SYSTEM_PROMPTS.chatAssistant}\n\nUser context:\n${context}`
      : SYSTEM_PROMPTS.chatAssistant

    // Stream response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = aiStream(systemPrompt, messages)
          for await (const chunk of gen) {
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        } catch (err) {
          console.error('Chat stream error:', err)
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    })
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json({ error: 'AI unavailable' }, { status: 500 })
  }
}
