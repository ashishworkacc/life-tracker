import { NextResponse } from 'next/server'

// GET /api/telegram/food-setup
// Call this once to register the food bot webhook with Telegram.
export async function GET() {
  const token = process.env.TELEGRAM_FOOD_BOT_TOKEN
  if (!token) return NextResponse.json({ error: 'TELEGRAM_FOOD_BOT_TOKEN not set' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })

  const webhookUrl = `${appUrl}/api/telegram/food-webhook`

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  })

  const data = await res.json()
  return NextResponse.json({ webhookUrl, telegram: data })
}
