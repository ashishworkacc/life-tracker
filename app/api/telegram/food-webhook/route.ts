import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { openrouter, DEFAULT_MODEL } from '@/lib/ai/client'

const FOOD_BOT_TOKEN = process.env.TELEGRAM_FOOD_BOT_TOKEN!

async function sendMessage(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${FOOD_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// IST = UTC+5:30
function toIST(): Date {
  return new Date(Date.now() + 330 * 60 * 1000)
}

function todayIST(): string {
  return toIST().toISOString().split('T')[0]
}

// Auto-detect meal type from IST hour
function getMealTypeByTime(): string {
  const h = toIST().getUTCHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 16) return 'Lunch'
  if (h >= 16 && h < 19) return 'Snack'
  if (h >= 19) return 'Dinner'
  return 'Snack' // 00:00–05:00 = late night
}

// Parse NL food text + estimate macros in one LLM call
async function parseFoodAndMacros(text: string, autoMeal: string) {
  const isDelivery = /zomato|swiggy|ordered|delivery|delivered/i.test(text)

  const response = await openrouter.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a nutrition assistant. Parse food log messages and estimate macros. Return ONLY valid JSON.',
      },
      {
        role: 'user',
        content: `Message: "${text}"
Auto-detected meal type (use unless user says otherwise): ${autoMeal}
Delivery order detected: ${isDelivery ? 'yes' : 'no'}

Return JSON:
{
  "food": "clean food name (e.g. Chicken Biryani)",
  "quantity": number or null,
  "unit": "plate|bowl|g|ml|piece|serving|cup|slice etc",
  "mealType": "Breakfast|Lunch|Dinner|Snack",
  "isZomato": boolean,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number
}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 300,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  return JSON.parse(raw)
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const message = body?.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat?.id
  const text = (message.text ?? '').trim()

  if (!chatId) return NextResponse.json({ ok: true })

  // /start — show welcome + chat ID
  if (text === '/start' || text.startsWith('/start ')) {
    await sendMessage(
      chatId,
      `🍽️ Welcome to Food Logger!\n\nJust tell me what you ate in plain English:\n• "2 eggs and toast"\n• "Large chicken biryani for lunch"\n• "Ordered butter chicken from Zomato"\n\nYour Chat ID: ${chatId}\n\n⚡ Your Life Tracker account must be linked first — go to t.me/ledger_ak_bot → /start → paste the Chat ID in Settings → Telegram.`,
    )
    return NextResponse.json({ ok: true })
  }

  if (!text) return NextResponse.json({ ok: true })

  // Look up user via shared telegram_links collection
  const db = adminDb()
  const linkDoc = await db.collection('telegram_links').doc(String(chatId)).get()

  if (!linkDoc.exists) {
    await sendMessage(
      chatId,
      `❌ Account not linked.\n\nGo to t.me/ledger_ak_bot → send /start → copy the Chat ID → paste it in Life Tracker → Settings → Telegram Check-Ins.`,
    )
    return NextResponse.json({ ok: true })
  }

  const { userId } = linkDoc.data() as { userId: string }
  const autoMeal = getMealTypeByTime()
  const date = todayIST()

  try {
    const parsed = await parseFoodAndMacros(text, autoMeal)

    const mealType = parsed.mealType || autoMeal
    const food = parsed.food || text
    const qty = parsed.quantity ?? null
    const unit = parsed.unit ?? null
    const calories = Math.round(parsed.calories || 0)
    const protein = Math.round((parsed.protein || 0) * 10) / 10
    const carbs = Math.round((parsed.carbs || 0) * 10) / 10
    const fat = Math.round((parsed.fat || 0) * 10) / 10
    const isZomato = !!(parsed.isZomato)

    await db.collection('food_logs').add({
      userId,
      date,
      mealType,
      description: food,
      quantity: qty,
      unit,
      calories,
      protein,
      carbs,
      fat,
      zomatoOrdered: isZomato,
      source: 'telegram',
    })

    const qtyStr = qty ? `${qty} ${unit || ''} of ` : ''
    const deliveryTag = isZomato ? ' 🛵' : ''

    await sendMessage(
      chatId,
      `✅ Logged: ${qtyStr}${food}${deliveryTag} → ${mealType}\n📊 ~${calories} kcal | ${protein}g protein | ${carbs}g carbs | ${fat}g fat\n\n📱 View in App → Food Tracker`,
    )
  } catch (err) {
    console.error('Food bot error:', err)
    await sendMessage(
      chatId,
      `❌ Couldn't parse that. Try:\n• "2 eggs and toast"\n• "Large chicken biryani for lunch"\n• "Protein shake 30g"`,
    )
  }

  return NextResponse.json({ ok: true })
}
