import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const { userId, sleepLogs, habitLogs, cravingLogs, foodLogs, moodLogs } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Build correlation dataset
    const sleepByDate: Record<string, number> = {}
    ;(sleepLogs ?? []).forEach((s: any) => { if (s.date && s.hoursSlept) sleepByDate[s.date] = s.hoursSlept })

    const habitsByDate: Record<string, { done: number; total: number }> = {}
    ;(habitLogs ?? []).forEach((h: any) => {
      if (!h.date) return
      if (!habitsByDate[h.date]) habitsByDate[h.date] = { done: 0, total: 0 }
      habitsByDate[h.date].total++
      if (h.completed) habitsByDate[h.date].done++
    })

    const cravingsByDate: Record<string, { count: number; avgIntensity: number }> = {}
    ;(cravingLogs ?? []).forEach((c: any) => {
      if (!c.date) return
      if (!cravingsByDate[c.date]) cravingsByDate[c.date] = { count: 0, avgIntensity: 0 }
      cravingsByDate[c.date].count++
      cravingsByDate[c.date].avgIntensity += c.intensity ?? 3
    })
    Object.keys(cravingsByDate).forEach(d => {
      cravingsByDate[d].avgIntensity = Math.round(cravingsByDate[d].avgIntensity / cravingsByDate[d].count * 10) / 10
    })

    const foodByDate: Record<string, { calories: number; protein: number }> = {}
    ;(foodLogs ?? []).forEach((f: any) => {
      if (!f.date) return
      if (!foodByDate[f.date]) foodByDate[f.date] = { calories: 0, protein: 0 }
      foodByDate[f.date].calories += f.calories ?? 0
      foodByDate[f.date].protein += f.protein ?? 0
    })

    // Build correlation matrix
    const dates = [...new Set([
      ...Object.keys(sleepByDate),
      ...Object.keys(habitsByDate),
      ...Object.keys(cravingsByDate),
    ])].sort().slice(-30) // last 30 days

    const matrix = dates.map(date => ({
      date,
      sleep: sleepByDate[date] ?? null,
      habitPct: habitsByDate[date] ? Math.round(habitsByDate[date].done / habitsByDate[date].total * 100) : null,
      cravings: cravingsByDate[date]?.count ?? 0,
      cravingIntensity: cravingsByDate[date]?.avgIntensity ?? null,
      calories: foodByDate[date]?.calories ?? null,
    }))

    // Find actionable correlations
    const lowSleepDays = matrix.filter(d => d.sleep !== null && d.sleep < 6)
    const goodSleepDays = matrix.filter(d => d.sleep !== null && d.sleep >= 7)
    const lowSleepCravingAvg = lowSleepDays.length > 0
      ? Math.round(lowSleepDays.reduce((s, d) => s + d.cravings, 0) / lowSleepDays.length * 10) / 10
      : null
    const goodSleepCravingAvg = goodSleepDays.length > 0
      ? Math.round(goodSleepDays.reduce((s, d) => s + d.cravings, 0) / goodSleepDays.length * 10) / 10
      : null

    const lowSleepHabitAvg = lowSleepDays.filter(d => d.habitPct !== null).length > 0
      ? Math.round(lowSleepDays.filter(d => d.habitPct !== null).reduce((s, d) => s + (d.habitPct ?? 0), 0) / lowSleepDays.filter(d => d.habitPct !== null).length)
      : null
    const goodSleepHabitAvg = goodSleepDays.filter(d => d.habitPct !== null).length > 0
      ? Math.round(goodSleepDays.filter(d => d.habitPct !== null).reduce((s, d) => s + (d.habitPct ?? 0), 0) / goodSleepDays.filter(d => d.habitPct !== null).length)
      : null

    if (dates.length < 5) {
      return NextResponse.json({
        correlations: [],
        message: 'Log at least 5 days of data to unlock correlations.',
      })
    }

    const prompt = `You are a behavioral data analyst. Analyze these 30-day cross-tracker correlations and generate exactly 3 specific, data-driven insights.

DATA SUMMARY:
- Days with sleep <6h: ${lowSleepDays.length} days
  → Avg cravings on those days: ${lowSleepCravingAvg ?? 'n/a'}
  → Avg habit completion on those days: ${lowSleepHabitAvg ?? 'n/a'}%
- Days with sleep ≥7h: ${goodSleepDays.length} days
  → Avg cravings: ${goodSleepCravingAvg ?? 'n/a'}
  → Avg habit completion: ${goodSleepHabitAvg ?? 'n/a'}%

RAW DATA (last 30 days):
${JSON.stringify(matrix.slice(-14), null, 2)}

Generate exactly 3 correlations in this JSON format:
[
  {
    "title": "Short punchy title (max 8 words)",
    "finding": "One sentence with specific numbers from the data",
    "action": "One concrete action to take based on this finding",
    "strength": "strong|moderate|weak",
    "trackers": ["sleep", "habits"]
  }
]

Rules: Only use numbers that appear in the data. Be specific. No fluff. Return valid JSON array only.`

    const text = await aiComplete(prompt, '', { maxTokens: 600 })

    let correlations: any[] = []
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) correlations = JSON.parse(jsonMatch[0])
    } catch {
      correlations = []
    }

    return NextResponse.json({ correlations, daysAnalyzed: dates.length })
  } catch (e) {
    console.error('/api/ai/correlations error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
