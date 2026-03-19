/**
 * Apple Health Sync Webhook
 *
 * Called by an iOS Shortcut running on iPhone/Apple Watch.
 * No OAuth required — the userId acts as the bearer token (stored securely in Shortcut).
 *
 * POST /api/health/apple-sync
 * Body (all fields optional except userId + date):
 * {
 *   userId: string,
 *   date: "YYYY-MM-DD",
 *   source: "shortcut" | "health-auto-export",
 *   weight?: number,           // kg
 *   bodyFat?: number,          // percentage 0–100
 *   leanMass?: number,         // kg
 *   muscleMass?: number,       // kg
 *   boneMass?: number,         // kg
 *   bmi?: number,
 *   steps?: number,
 *   activeEnergy?: number,     // kcal
 *   restingEnergy?: number,    // kcal
 *   exerciseMinutes?: number,
 *   standHours?: number,
 *   moveRingPct?: number,      // 0–100
 *   exerciseRingPct?: number,  // 0–100
 *   standRingPct?: number,     // 0–100
 *   heartRateAvg?: number,     // bpm
 *   heartRateResting?: number, // bpm
 *   heartRateMax?: number,     // bpm
 *   hrv?: number,              // ms SDNN
 *   vo2Max?: number,           // mL/kg/min
 *   spo2?: number,             // %
 *   respiratoryRate?: number,  // breaths/min
 *   sleepHours?: number,       // decimal hours
 *   sleepDeep?: number,        // hours
 *   sleepRem?: number,         // hours
 *   sleepAwake?: number,       // hours
 *   sleepScore?: number,       // 0–100 if available
 *   bloodPressureSystolic?: number,
 *   bloodPressureDiastolic?: number,
 *   bodyTemp?: number,         // celsius
 *   workouts?: { type: string; minutes: number; calories: number }[],
 * }
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, date, source = 'shortcut', ...metrics } = body

    if (!userId || !date) {
      return NextResponse.json({ error: 'userId and date are required' }, { status: 400 })
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }

    // Dynamic import to avoid SSR issues
    const { addDocument, queryDocuments, updateDocument } = await import('@/lib/firebase/db')
    const { where } = await import('@/lib/firebase/db')

    // Verify user exists
    const { getUserDoc } = await import('@/lib/firebase/db')
    const userDoc = await getUserDoc(userId)
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Clean metrics — remove nulls, undefined, and non-numeric junk
    const cleanMetrics: Record<string, number | string | object> = {}
    for (const [k, v] of Object.entries(metrics)) {
      if (v === null || v === undefined || v === '') continue
      if (typeof v === 'number' && isNaN(v)) continue
      cleanMetrics[k] = v
    }

    const syncedAt = new Date().toISOString()

    // Upsert: check if record exists for this user+date, update or create
    const existing = await queryDocuments('apple_health_logs', [
      where('userId', '==', userId),
      where('date', '==', date),
    ])

    let docId: string
    if (existing.length > 0) {
      docId = existing[0].id
      await updateDocument('apple_health_logs', docId, {
        ...cleanMetrics,
        source,
        syncedAt,
        updatedAt: syncedAt,
      })
    } else {
      const ref = await addDocument('apple_health_logs', {
        userId,
        date,
        source,
        ...cleanMetrics,
        syncedAt,
        createdAt: syncedAt,
      })
      docId = ref?.id ?? ''
    }

    // Also sync weight into weight_logs if weight is provided
    if (cleanMetrics.weight) {
      const wExisting = await queryDocuments('weight_logs', [
        where('userId', '==', userId),
        where('date', '==', date),
      ])
      const wPayload = {
        userId, date,
        weight: cleanMetrics.weight,
        bodyFat: cleanMetrics.bodyFat ?? null,
        muscleMass: cleanMetrics.muscleMass ?? null,
        leanMass: cleanMetrics.leanMass ?? null,
        source: 'apple_health',
        syncedAt,
      }
      if (wExisting.length > 0) {
        await updateDocument('weight_logs', wExisting[0].id, wPayload)
      } else {
        await addDocument('weight_logs', wPayload)
      }
    }

    // Also sync sleep into sleep_logs if sleepHours is provided
    if (cleanMetrics.sleepHours) {
      const sExisting = await queryDocuments('sleep_logs', [
        where('userId', '==', userId),
        where('date', '==', date),
      ])
      const sPayload = {
        userId, date,
        hoursSlept: cleanMetrics.sleepHours,
        deepSleep: cleanMetrics.sleepDeep ?? null,
        remSleep: cleanMetrics.sleepRem ?? null,
        awakeTime: cleanMetrics.sleepAwake ?? null,
        sleepScore: cleanMetrics.sleepScore ?? null,
        source: 'apple_health',
        syncedAt,
      }
      if (sExisting.length > 0) {
        await updateDocument('sleep_logs', sExisting[0].id, sPayload)
      } else {
        await addDocument('sleep_logs', sPayload)
      }
    }

    return NextResponse.json({
      success: true,
      docId,
      date,
      metricsReceived: Object.keys(cleanMetrics).length,
      message: `Synced ${Object.keys(cleanMetrics).length} health metrics for ${date}`,
    })
  } catch (e) {
    console.error('/api/health/apple-sync error:', e)
    return NextResponse.json({ error: 'Sync failed', details: String(e) }, { status: 500 })
  }
}

// Allow GET to test the endpoint (returns setup info)
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/health/apple-sync',
    method: 'POST',
    description: 'Apple Health webhook for iOS Shortcuts',
    requiredFields: ['userId', 'date'],
    optionalFields: [
      'weight', 'bodyFat', 'leanMass', 'muscleMass', 'steps',
      'activeEnergy', 'heartRateAvg', 'heartRateResting', 'hrv',
      'vo2Max', 'spo2', 'sleepHours', 'sleepDeep', 'sleepRem',
      'exerciseMinutes', 'standHours', 'moveRingPct',
    ],
    status: 'active',
  })
}
