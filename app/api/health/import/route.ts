/**
 * Batch import endpoint for Apple Health ZIP parse results.
 * Receives pre-aggregated daily health records (computed client-side) and
 * upserts them into Firestore.
 *
 * POST /api/health/import
 * { userId: string, records: DailyRecord[] }
 * Each DailyRecord: { date: "YYYY-MM-DD", weight?, bodyFat?, steps?, ... }
 */

import { NextRequest, NextResponse } from 'next/server'

interface DailyRecord {
  date: string
  weight?: number
  bodyFat?: number
  leanMass?: number
  bmi?: number
  heartRateResting?: number
  heartRateAvg?: number
  hrv?: number
  vo2Max?: number
  spo2?: number
  respiratoryRate?: number
  steps?: number
  activeEnergy?: number
  restingEnergy?: number
  exerciseMinutes?: number
  standHours?: number
  sleepHours?: number
  sleepDeep?: number
  sleepRem?: number
  sleepCore?: number
  bloodPressureSystolic?: number
  bloodPressureDiastolic?: number
}

export async function POST(req: NextRequest) {
  try {
    const { userId, records } = await req.json() as { userId: string; records: DailyRecord[] }

    if (!userId || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'userId and records[] required' }, { status: 400 })
    }

    if (records.length > 120) {
      return NextResponse.json({ error: 'Max 120 records per batch' }, { status: 400 })
    }

    // Dynamic imports to avoid SSR issues
    const { addDocument, queryDocuments, updateDocument } = await import('@/lib/firebase/db')
    const { where } = await import('@/lib/firebase/db')
    const { getUserDoc } = await import('@/lib/firebase/db')

    const userDoc = await getUserDoc(userId)
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const syncedAt = new Date().toISOString()
    const results = { inserted: 0, updated: 0, skipped: 0 }

    for (const record of records) {
      if (!record.date || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
        results.skipped++
        continue
      }

      // Strip undefined fields
      const clean: Record<string, number | string> = { date: record.date }
      const FIELDS: (keyof DailyRecord)[] = [
        'weight', 'bodyFat', 'leanMass', 'bmi',
        'heartRateResting', 'heartRateAvg', 'hrv', 'vo2Max', 'spo2', 'respiratoryRate',
        'steps', 'activeEnergy', 'restingEnergy', 'exerciseMinutes', 'standHours',
        'sleepHours', 'sleepDeep', 'sleepRem', 'sleepCore',
        'bloodPressureSystolic', 'bloodPressureDiastolic',
      ]
      for (const f of FIELDS) {
        const v = record[f]
        if (v !== undefined && v !== null && !isNaN(Number(v))) {
          clean[f as string] = Number(v)
        }
      }

      if (Object.keys(clean).length <= 1) { results.skipped++; continue }

      try {
        const existing = await queryDocuments('apple_health_logs', [
          where('userId', '==', userId),
          where('date', '==', record.date),
        ])

        if (existing.length > 0) {
          // Merge: only overwrite fields that are now present (don't erase manually-entered data)
          await updateDocument('apple_health_logs', existing[0].id, {
            ...clean, source: 'zip_import', syncedAt,
          })
          results.updated++
        } else {
          await addDocument('apple_health_logs', {
            userId,
            ...clean,
            source: 'zip_import',
            syncedAt,
            createdAt: syncedAt,
          })
          results.inserted++
        }

        // Mirror weight → weight_logs
        if (record.weight) {
          const wExisting = await queryDocuments('weight_logs', [
            where('userId', '==', userId),
            where('date', '==', record.date),
          ])
          const wPayload = {
            userId, date: record.date,
            weight: record.weight,
            bodyFat: record.bodyFat ?? null,
            leanMass: record.leanMass ?? null,
            source: 'apple_health',
            syncedAt,
          }
          if (wExisting.length > 0) {
            await updateDocument('weight_logs', wExisting[0].id, wPayload)
          } else {
            await addDocument('weight_logs', wPayload)
          }
        }

        // Mirror sleep → sleep_logs
        if (record.sleepHours && record.sleepHours > 0.5) {
          const sExisting = await queryDocuments('sleep_logs', [
            where('userId', '==', userId),
            where('date', '==', record.date),
          ])
          const sPayload = {
            userId, date: record.date,
            hoursSlept: record.sleepHours,
            deepSleep: record.sleepDeep ?? null,
            remSleep: record.sleepRem ?? null,
            coreSleep: record.sleepCore ?? null,
            source: 'apple_health',
            syncedAt,
          }
          if (sExisting.length > 0) {
            await updateDocument('sleep_logs', sExisting[0].id, sPayload)
          } else {
            await addDocument('sleep_logs', sPayload)
          }
        }
      } catch (e) {
        console.error(`Failed to upsert ${record.date}:`, e)
        results.skipped++
      }
    }

    return NextResponse.json({
      success: true,
      batch: records.length,
      ...results,
    })
  } catch (e) {
    console.error('/api/health/import error:', e)
    return NextResponse.json({ error: 'Import failed', details: String(e) }, { status: 500 })
  }
}
