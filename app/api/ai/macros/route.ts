import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { food, quantity, unit } = await req.json()
    if (!food) return NextResponse.json({ error: 'No food provided' }, { status: 400 })

    const prompt = `Give the nutritional information for: ${food}${quantity ? `, ${quantity} ${unit || 'g'}` : ''}.
Return ONLY a JSON object with these fields (numbers only, no units in values):
{"calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number}
Use typical values for this food/quantity. If unknown, make a reasonable estimate.`

    const result = await aiComplete(
      'You are a nutrition database. Return only valid JSON with macronutrient data. No explanation, no markdown.',
      prompt
    )

    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    const macros = JSON.parse(jsonMatch[0])

    return NextResponse.json({
      calories: Math.round(macros.calories ?? 0),
      protein: Math.round((macros.protein ?? 0) * 10) / 10,
      carbs: Math.round((macros.carbs ?? 0) * 10) / 10,
      fat: Math.round((macros.fat ?? 0) * 10) / 10,
      fiber: Math.round((macros.fiber ?? 0) * 10) / 10,
    })
  } catch (err) {
    console.error('Macros API error:', err)
    return NextResponse.json({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
  }
}
