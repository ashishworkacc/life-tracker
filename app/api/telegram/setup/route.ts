import { NextRequest, NextResponse } from 'next/server'

// One-time endpoint to register the webhook URL with Telegram.
// Hit this once after deploying: GET /api/telegram/setup
export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get('origin')

  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret ?? undefined,
      allowed_updates: ['message'],
    }),
  })

  const data = await res.json()
  return NextResponse.json({ webhookUrl, telegram: data })
}
