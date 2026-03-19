import { NextRequest, NextResponse } from 'next/server'
import { aiComplete } from '@/lib/ai/client'

export async function POST(req: NextRequest) {
  try {
    const {
      userId,
      weekDates,          // ['2026-03-13', ..., '2026-03-19']
      habitsData,         // [{ name, effort, completedDays, totalDays, category }]
      todosData,          // [{ title, completed, priority }]
      goalsData,          // [{ title, category, progress, target }]
      journalEntries,     // [{ date, win, gratitude, intention }]
      xpEarned,           // total XP this week
      sleepAvg,           // avg sleep hours
      moodAvg,            // avg mood 1-5
      lifeOS,             // { mission, values, beliefs, strategies, challenges }
      aiSignals,          // [{ type: 'insight'|'brief', rating: 'up'|'down', content }]
    } = await req.json()

    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Build context
    const weekLabel = weekDates?.length
      ? `${weekDates[0]} to ${weekDates[weekDates.length - 1]}`
      : 'this week'

    const habitsSummary = (habitsData ?? []).map((h: any) =>
      `  • ${h.name} [${h.effort ?? 'medium'}] — ${h.completedDays}/${h.totalDays} days (${Math.round((h.completedDays / Math.max(h.totalDays, 1)) * 100)}%)`
    ).join('\n')

    const todosSummary = (() => {
      const done = (todosData ?? []).filter((t: any) => t.completed)
      const missed = (todosData ?? []).filter((t: any) => !t.completed)
      return `Completed: ${done.length} / Total: ${(todosData ?? []).length}\nMissed P1s: ${missed.filter((t: any) => t.priority === 'p1').map((t: any) => t.title).join(', ') || 'none'}`
    })()

    const goalsSummary = (goalsData ?? []).map((g: any) =>
      `  • ${g.title} (${g.category}): ${g.progress}/${g.target}`
    ).join('\n')

    const lifeOSContext = lifeOS ? `
IDENTITY CONTEXT:
Mission: ${lifeOS.mission || 'Not set'}
Core Values: ${(lifeOS.values ?? []).join(', ') || 'Not set'}
Beliefs: ${(lifeOS.beliefs ?? []).join(' | ') || 'Not set'}
Strategies: ${(lifeOS.strategies ?? []).join(' | ') || 'Not set'}
Current Challenges: ${(lifeOS.challenges ?? []).join(', ') || 'None listed'}
` : ''

    const signalContext = (aiSignals ?? []).length > 0 ? `
USER FEEDBACK ON PAST AI ADVICE:
${aiSignals.map((s: any) => `  ${s.rating === 'up' ? '👍' : '👎'} "${s.content.slice(0, 80)}"`).join('\n')}
(Use thumbs-down signals to avoid repeating similar advice.)
` : ''

    const prompt = `You are a rigorous, warm personal coach running a PAI-style weekly review.

WEEK: ${weekLabel}
${lifeOSContext}
HABITS THIS WEEK:
${habitsSummary || 'No habit data'}

TODOS:
${todosSummary}

GOALS PROGRESS:
${goalsSummary || 'No goals data'}

STATS:
- XP Earned: ${xpEarned ?? 0}
- Avg Sleep: ${sleepAvg ? sleepAvg + 'h' : 'Not tracked'}
- Avg Mood: ${moodAvg ? moodAvg + '/5' : 'Not tracked'}
${signalContext}

Write a structured weekly review in exactly this format. Be specific, data-driven, and honest. Reference the user's actual mission and values when relevant. Do NOT be generic.

## 🏆 Week Score
Give a score out of 10 with a one-line verdict. Format: "X/10 — [verdict]"

## ✅ Wins
3 specific wins from this week's data. Be concrete (name actual habits/tasks).

## ⚠️ Misses & Gaps
2-3 honest observations about what fell short. Name specific habits or goals.

## 📈 Trends to Watch
2 patterns emerging from the data — positive or negative. Think across multiple dimensions (sleep, habits, mood, XP).

## 🧭 Mission Alignment
1 paragraph: How well did this week's actions align with the stated mission and values? Where was there friction?

## ⚡ Top 3 Priorities for Next Week
3 specific, actionable priorities. Each should be tied to a goal or challenge. Format as: "1. [Priority] — [Why it matters]"

## 💡 One Insight
One non-obvious insight from this week's patterns that the user might not have noticed themselves.`

    const review = await aiComplete(
      'You are a world-class personal coach running a PAI-style weekly review. You are honest, specific, and use actual data to generate insights. Never be generic. Always reference the user\'s actual mission and values. Format output in clean markdown.',
      prompt,
      { maxTokens: 900 }
    )

    return NextResponse.json({ review })
  } catch (e: any) {
    console.error('weekly-review error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
