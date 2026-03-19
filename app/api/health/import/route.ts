import { NextRequest, NextResponse } from 'next/server'

interface DailyRecord { date: string; [key: string]: number | string | null | undefined }
interface WorkoutRecord {
  date: string; startDate: string; endDate: string; type: string; duration: number
  calories?: number; distance?: number; distanceUnit?: string
  avgHR?: number; maxHR?: number; minHR?: number; source: string
}

export async function POST(req: NextRequest) {
  try {
    const { userId, records = [], workouts = [] } = await req.json() as {
      userId: string; records: DailyRecord[]; workouts: WorkoutRecord[]
    }
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const { addDocument, queryDocuments, updateDocument } = await import('@/lib/firebase/db')
    const { where } = await import('@/lib/firebase/db')
    const { getUserDoc } = await import('@/lib/firebase/db')
    const userDoc = await getUserDoc(userId)
    if (!userDoc) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const syncedAt = new Date().toISOString()
    const stats = { days: { inserted: 0, updated: 0 }, workouts: { inserted: 0, updated: 0 } }

    // ── Upsert daily records ─────────────────────────────────────────────────
    for (const record of records) {
      if (!record.date) continue
      const clean: Record<string, number | string | null> = { date: record.date }
      for (const [k, v] of Object.entries(record)) {
        if (k === 'date') continue
        if (v !== undefined && v !== null && !isNaN(Number(v))) clean[k] = Number(v)
      }
      if (Object.keys(clean).length <= 1) continue

      const existing = await queryDocuments('apple_health_logs', [
        where('userId', '==', userId), where('date', '==', record.date),
      ])
      if (existing.length > 0) {
        await updateDocument('apple_health_logs', existing[0].id, { ...clean, source: 'zip_import', syncedAt })
        stats.days.updated++
      } else {
        await addDocument('apple_health_logs', { userId, ...clean, source: 'zip_import', syncedAt, createdAt: syncedAt })
        stats.days.inserted++
      }

      // Mirror to weight_logs
      if (clean.weight) {
        const w = await queryDocuments('weight_logs', [where('userId', '==', userId), where('date', '==', record.date)])
        const wp = { userId, date: record.date, weight: clean.weight, bodyFat: clean.bodyFat ?? null, leanMass: clean.leanMass ?? null, source: 'apple_health', syncedAt }
        if (w.length > 0) await updateDocument('weight_logs', w[0].id, wp)
        else await addDocument('weight_logs', wp)
      }

      // Mirror to sleep_logs
      if (clean.sleepHours && Number(clean.sleepHours) > 0.5) {
        const s = await queryDocuments('sleep_logs', [where('userId', '==', userId), where('date', '==', record.date)])
        const sp = { userId, date: record.date, hoursSlept: clean.sleepHours, deepSleep: clean.sleepDeep ?? null, remSleep: clean.sleepRem ?? null, coreSleep: clean.sleepCore ?? null, source: 'apple_health', syncedAt }
        if (s.length > 0) await updateDocument('sleep_logs', s[0].id, sp)
        else await addDocument('sleep_logs', sp)
      }
    }

    // ── Upsert workouts ──────────────────────────────────────────────────────
    for (const w of workouts) {
      if (!w.date || !w.type) continue
      const payload = {
        userId, date: w.date, startDate: w.startDate, endDate: w.endDate,
        type: w.type, duration: w.duration,
        calories: w.calories ?? null, distance: w.distance ?? null,
        distanceUnit: w.distanceUnit ?? null, avgHR: w.avgHR ?? null,
        maxHR: w.maxHR ?? null, minHR: w.minHR ?? null,
        source: w.source, syncedAt,
      }
      // Use startDate as dedup key (unique per workout)
      const existing = await queryDocuments('workout_logs', [
        where('userId', '==', userId), where('startDate', '==', w.startDate),
      ])
      if (existing.length > 0) {
        await updateDocument('workout_logs', existing[0].id, payload)
        stats.workouts.updated++
      } else {
        await addDocument('workout_logs', { ...payload, createdAt: syncedAt })
        stats.workouts.inserted++
      }
    }

    return NextResponse.json({ success: true, stats })
  } catch (e) {
    console.error('/api/health/import:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
