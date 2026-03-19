/**
 * Apple Health import — uses deterministic document IDs so every write is
 * a simple setDoc (no read-then-write upsert). This is ~3× faster and
 * never times out on Vercel.
 *
 * Doc IDs:
 *   apple_health_logs : `${userId}_${date}`            e.g. uid_2026-03-19
 *   workout_logs      : `${userId}_${sanitisedStart}`  e.g. uid_20260319063000
 */

import { NextRequest, NextResponse } from 'next/server'

interface DailyRecord { date: string; [key: string]: number | string | null | undefined }
interface WorkoutRecord {
  date: string; startDate: string; endDate: string
  type: string; duration: number
  calories?: number; distance?: number; distanceUnit?: string
  avgHR?: number; maxHR?: number; minHR?: number; source: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userId: string = body.userId
    const records: DailyRecord[]  = body.records  ?? []
    const workouts: WorkoutRecord[] = body.workouts ?? []

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    // Single dynamic import — avoids triple import overhead
    const db = await import('@/lib/firebase/db')
    const syncedAt = new Date().toISOString()

    // ── Daily health records ────────────────────────────────────────────────
    const dayResults = await Promise.allSettled(
      records
        .filter(r => r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
        .map(async record => {
          // Strip undefined / non-numeric values
          const clean: Record<string, number | string | null> = {
            userId,
            date: record.date as string,
            source: 'zip_import',
            syncedAt,
          }
          for (const [k, v] of Object.entries(record)) {
            if (k === 'date') continue
            if (v !== undefined && v !== null && !isNaN(Number(v))) {
              clean[k] = Number(v)
            }
          }

          // Deterministic doc ID — setDoc is an upsert with no prior read
          const docId = `${userId}_${record.date}`
          await db.setDocument('apple_health_logs', docId, clean)
          return docId
        })
    )

    // ── Workouts ────────────────────────────────────────────────────────────
    const workoutResults = await Promise.allSettled(
      workouts
        .filter(w => w.date && w.type && w.startDate)
        .map(async w => {
          // Sanitise startDate into a safe doc ID segment
          const safeStart = w.startDate.replace(/[^0-9]/g, '').substring(0, 14)
          const docId = `${userId}_${safeStart}`

          const payload: Record<string, number | string | null> = {
            userId,
            date: w.date,
            startDate: w.startDate,
            endDate: w.endDate ?? w.startDate,
            type: w.type,
            duration: Math.round(w.duration ?? 0),
            calories: w.calories != null ? Math.round(w.calories) : null,
            distance: w.distance ?? null,
            distanceUnit: w.distanceUnit ?? null,
            avgHR: w.avgHR ?? null,
            maxHR: w.maxHR ?? null,
            minHR: w.minHR ?? null,
            source: w.source ?? 'apple_health',
            syncedAt,
          }

          await db.setDocument('workout_logs', docId, payload)
          return docId
        })
    )

    const dayOk    = dayResults.filter(r => r.status === 'fulfilled').length
    const dayFail  = dayResults.filter(r => r.status === 'rejected').length
    const wktOk    = workoutResults.filter(r => r.status === 'fulfilled').length
    const wktFail  = workoutResults.filter(r => r.status === 'rejected').length

    // Surface first error for debugging
    const firstErr = [...dayResults, ...workoutResults].find(r => r.status === 'rejected')
    if (firstErr && firstErr.status === 'rejected') {
      console.error('Import partial error:', firstErr.reason)
    }

    return NextResponse.json({
      success: true,
      days:     { saved: dayOk,  failed: dayFail },
      workouts: { saved: wktOk,  failed: wktFail },
    })
  } catch (e) {
    console.error('/api/health/import:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
