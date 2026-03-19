'use client'

import { useState, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { setDocument } from '@/lib/firebase/db'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DailyRecord {
  date: string
  weight?: number; bodyFat?: number; leanMass?: number; bmi?: number
  heartRateResting?: number; heartRateAvg?: number; hrv?: number
  vo2Max?: number; spo2?: number; respiratoryRate?: number
  steps?: number; activeEnergy?: number; restingEnergy?: number
  exerciseMinutes?: number; standHours?: number
  sleepHours?: number; sleepDeep?: number; sleepRem?: number; sleepCore?: number
  sleepStart?: string; sleepEnd?: string
  bloodPressureSystolic?: number; bloodPressureDiastolic?: number
  [key: string]: number | string | undefined
}

interface WorkoutRecord {
  date: string; startDate: string; endDate: string
  type: string; duration: number
  calories?: number; distance?: number; distanceUnit?: string
  avgHR?: number; maxHR?: number; minHR?: number; source: string
}

// ─── Metric config ─────────────────────────────────────────────────────────
const RECORD_TYPES: Record<string, { field: string; agg: 'last' | 'sum' | 'avg'; mult?: number }> = {
  HKQuantityTypeIdentifierBodyMass:                 { field: 'weight',        agg: 'last' },
  HKQuantityTypeIdentifierBodyFatPercentage:         { field: 'bodyFat',       agg: 'last', mult: 100 },
  HKQuantityTypeIdentifierLeanBodyMass:              { field: 'leanMass',      agg: 'last' },
  HKQuantityTypeIdentifierBodyMassIndex:             { field: 'bmi',           agg: 'last' },
  HKQuantityTypeIdentifierVO2Max:                    { field: 'vo2Max',        agg: 'last' },
  HKQuantityTypeIdentifierRestingHeartRate:          { field: '_restingHr',    agg: 'avg' },
  HKQuantityTypeIdentifierHeartRate:                 { field: '_hr',           agg: 'avg' },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN:  { field: '_hrv',          agg: 'avg' },
  HKQuantityTypeIdentifierOxygenSaturation:          { field: '_spo2',         agg: 'avg', mult: 100 },
  HKQuantityTypeIdentifierRespiratoryRate:           { field: '_rr',           agg: 'avg' },
  HKQuantityTypeIdentifierStepCount:                 { field: 'steps',         agg: 'sum' },
  HKQuantityTypeIdentifierActiveEnergyBurned:        { field: 'activeEnergy',  agg: 'sum' },
  HKQuantityTypeIdentifierBasalEnergyBurned:         { field: 'restingEnergy', agg: 'sum' },
  HKQuantityTypeIdentifierAppleExerciseTime:         { field: 'exerciseMinutes', agg: 'sum' },
  HKQuantityTypeIdentifierAppleStandTime:            { field: '_standMin',     agg: 'sum' },
  HKQuantityTypeIdentifierBloodPressureSystolic:     { field: '_bpSys',        agg: 'avg' },
  HKQuantityTypeIdentifierBloodPressureDiastolic:    { field: '_bpDia',        agg: 'avg' },
}

// ─── Regex (pre-compiled) ────────────────────────────────────────────────────
const RX_TYPE   = /type="([^"]+)"/
const RX_VALUE  = /\bvalue="([^"]+)"/
const RX_START  = /startDate="([^"]+)"/
const RX_END    = /endDate="([^"]+)"/
const RX_DCMP   = /dateComponents="([^"]+)"/
const RX_AE     = /activeEnergyBurned="([^"]+)"/
const RX_EX     = /appleExerciseTime="([^"]+)"/
const RX_SH     = /appleStandHours="([^"]+)"/
const RX_W_TYPE = /workoutActivityType="([^"]+)"/
const RX_W_DUR  = /\bduration="([^"]+)"/
const RX_W_CAL  = /totalEnergyBurned="([^"]+)"/
const RX_W_DIST = /totalDistance="([^"]+)"/
const RX_W_DSTU = /totalDistanceUnit="([^"]+)"/
const RX_W_SRC  = /sourceName="([^"]+)"/
const RX_WS_AVG = /average="([^"]+)"/
const RX_WS_MAX = /maximum="([^"]+)"/
const RX_WS_MIN = /minimum="([^"]+)"/
const RX_WS_SUM = /sum="([^"]+)"/

// ─── Sleep stage types ───────────────────────────────────────────────────────
const SLEEP_STAGE_MAP: Record<string, 'deep' | 'rem' | 'core' | 'unspecified'> = {
  HKCategoryValueSleepAnalysisAsleepDeep:        'deep',
  HKCategoryValueSleepAnalysisAsleepREM:          'rem',
  HKCategoryValueSleepAnalysisAsleepCore:         'core',
  HKCategoryValueSleepAnalysisAsleepUnspecified:  'unspecified',
}

interface SleepInterval { start: Date; end: Date; stage: 'deep' | 'rem' | 'core' | 'unspecified' }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getOrCreate(map: Map<string, DailyRecord>, date: string): DailyRecord {
  if (!map.has(date)) map.set(date, { date })
  return map.get(date)!
}

function applyRecord(day: DailyRecord, field: string, value: number, agg: 'last' | 'sum' | 'avg') {
  if (agg === 'last') { day[field] = value }
  else if (agg === 'sum') { day[field] = ((day[field] as number | undefined) ?? 0) + value }
  else {
    day[field + 'Sum'] = ((day[field + 'Sum'] as number | undefined) ?? 0) + value
    day[field + 'Cnt'] = ((day[field + 'Cnt'] as number | undefined) ?? 0) + 1
  }
}

/**
 * Merge overlapping sleep intervals to avoid double-counting when
 * iPhone records one big "Unspecified" total AND Apple Watch records
 * individual stage segments for the same time window.
 * Returns { totalH, deepH, remH, coreH, firstStart, lastEnd }
 */
function aggregateSleep(intervals: SleepInterval[]) {
  if (intervals.length === 0) return null

  // Sort all by start
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime())

  // Merge overlapping intervals to get true total (union)
  const merged: [Date, Date][] = []
  let [cs, ce] = [sorted[0].start, sorted[0].end]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= ce) {
      if (sorted[i].end > ce) ce = sorted[i].end
    } else {
      merged.push([cs, ce]); cs = sorted[i].start; ce = sorted[i].end
    }
  }
  merged.push([cs, ce])

  const totalH = merged.reduce((s, [a, b]) => s + (b.getTime() - a.getTime()) / 3_600_000, 0)

  // Stage sums — only from non-Unspecified intervals (they don't overlap each other)
  const staged = intervals.filter(i => i.stage !== 'unspecified')
  const deepH = staged.filter(i => i.stage === 'deep').reduce((s, i) => s + (i.end.getTime() - i.start.getTime()) / 3_600_000, 0)
  const remH  = staged.filter(i => i.stage === 'rem' ).reduce((s, i) => s + (i.end.getTime() - i.start.getTime()) / 3_600_000, 0)
  const coreH = staged.filter(i => i.stage === 'core').reduce((s, i) => s + (i.end.getTime() - i.start.getTime()) / 3_600_000, 0)

  const firstStart = sorted[0].start.toISOString()
  const lastEnd    = sorted[sorted.length - 1].end.toISOString()

  return { totalH, deepH, remH, coreH, firstStart, lastEnd }
}

function finalizeDay(d: DailyRecord): Record<string, number | string> {
  const out: Record<string, number | string> = { date: d.date }
  const avgs: [string, string][] = [
    ['_hr', 'heartRateAvg'], ['_restingHr', 'heartRateResting'],
    ['_hrv', 'hrv'], ['_spo2', 'spo2'], ['_rr', 'respiratoryRate'],
    ['_bpSys', 'bloodPressureSystolic'], ['_bpDia', 'bloodPressureDiastolic'],
  ]
  for (const [p, o] of avgs) {
    const s = d[p + 'Sum'] as number | undefined, c = d[p + 'Cnt'] as number | undefined
    if (s !== undefined && c && c > 0) out[o] = Math.round((s / c) * 10) / 10
  }
  const sm = d['_standMinSum'] as number | undefined
  if (sm !== undefined) out.standHours = Math.round(sm / 60 * 10) / 10

  const KEEP = ['weight','bodyFat','leanMass','bmi','vo2Max','steps','activeEnergy','restingEnergy',
    'exerciseMinutes','sleepHours','sleepDeep','sleepRem','sleepCore','sleepStart','sleepEnd']
  for (const f of KEEP) {
    const v = d[f]
    if (v !== undefined) {
      if (typeof v === 'string') out[f] = v
      else out[f] = Math.round((v as number) * 100) / 100
    }
  }
  return out
}

function parseWorkoutBlock(buf: string, workouts: WorkoutRecord[], cutoffStr: string) {
  const lines = buf.split('\n')
  const firstLine = lines[0]
  if (!firstLine.includes('<Workout ')) return
  const typeM  = RX_W_TYPE.exec(firstLine)
  const startM = RX_START.exec(firstLine)
  const endM   = RX_END.exec(firstLine)
  const durM   = RX_W_DUR.exec(firstLine)
  const srcM   = RX_W_SRC.exec(firstLine)
  if (!typeM || !startM) return
  const date = startM[1].substring(0, 10)
  if (date < cutoffStr) return

  let calories: number | undefined
  const calM = RX_W_CAL.exec(firstLine)
  if (calM) calories = Math.round(parseFloat(calM[1]))

  let distance: number | undefined
  let distUnit: string | undefined
  const distM = RX_W_DIST.exec(firstLine); const distUM = RX_W_DSTU.exec(firstLine)
  if (distM) { distance = Math.round(parseFloat(distM[1]) * 100) / 100; distUnit = distUM?.[1] }

  let avgHR: number | undefined, maxHR: number | undefined, minHR: number | undefined

  for (const line of lines.slice(1)) {
    const t = line.trim()
    if (!t.startsWith('<WorkoutStatistics')) continue
    const wsType = RX_TYPE.exec(t)?.[1]
    if (wsType === 'HKQuantityTypeIdentifierHeartRate') {
      const a = RX_WS_AVG.exec(t); const x = RX_WS_MAX.exec(t); const n = RX_WS_MIN.exec(t)
      if (a) avgHR = Math.round(parseFloat(a[1]))
      if (x) maxHR = Math.round(parseFloat(x[1]))
      if (n) minHR = Math.round(parseFloat(n[1]))
    }
    if (!calories && (wsType === 'HKQuantityTypeIdentifierActiveEnergyBurned' || wsType === 'HKQuantityTypeIdentifierBasalEnergyBurned')) {
      const s = RX_WS_SUM.exec(t); if (s) calories = Math.round(parseFloat(s[1]))
    }
    if (!distance && wsType === 'HKQuantityTypeIdentifierDistanceWalkingRunning') {
      const s = RX_WS_SUM.exec(t); if (s) { distance = Math.round(parseFloat(s[1]) * 100) / 100; distUnit = 'km' }
    }
  }

  workouts.push({
    date,
    startDate: startM[1],
    endDate: endM?.[1] ?? startM[1],
    type: typeM[1],
    duration: durM ? Math.round(parseFloat(durM[1])) : 0,
    calories, distance, distanceUnit: distUnit,
    avgHR, maxHR, minHR,
    source: srcM?.[1] ?? 'Apple Health',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HealthImportPage() {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'parsing' | 'uploading' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<{ days: number; workouts: number; from: string; to: string } | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  const processFile = useCallback(async (file: File) => {
    if (!user) return
    if (!file.name.endsWith('.zip')) {
      setErrMsg('Please upload the export.zip file exported from the Health app.')
      setPhase('error'); return
    }
    try {
      setPhase('reading'); setProgress(3); setLabel('Reading ZIP…')
      const JSZip = (await import('jszip')).default
      const ab = await file.arrayBuffer()
      setProgress(8); setLabel('Extracting ZIP…')
      const zip = await JSZip.loadAsync(ab)
      const xmlEntry = zip.file(/export\.xml$/)[0]
      if (!xmlEntry) throw new Error('No export.xml found in the ZIP. Export from Health app → Profile → Export All Health Data.')
      setProgress(12); setLabel(`Decompressing ${xmlEntry.name}…`)

      setPhase('parsing')
      const xmlBuf = await xmlEntry.async('arraybuffer')
      const uint8 = new Uint8Array(xmlBuf)
      const totalBytes = uint8.byteLength
      const decoder = new TextDecoder('utf-8')
      const CHUNK = 4 * 1024 * 1024

      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
      const cutoffStr = cutoff.toISOString().substring(0, 10)

      const dayMap = new Map<string, DailyRecord>()
      // Collect sleep intervals per date for proper merging
      const sleepByDate = new Map<string, SleepInterval[]>()
      const workouts: WorkoutRecord[] = []

      let leftover = ''
      let inWorkout = false
      let workoutBuf = ''

      setProgress(15); setLabel('Scanning health records (last 30 days)…')

      for (let offset = 0; offset < totalBytes; offset += CHUNK) {
        const isLast = offset + CHUNK >= totalBytes
        const slice = uint8.subarray(offset, Math.min(offset + CHUNK, totalBytes))
        const decoded = decoder.decode(slice, { stream: !isLast })
        const text = leftover + decoded
        const lastNL = isLast ? text.length : text.lastIndexOf('\n')
        leftover = isLast ? '' : text.substring(lastNL + 1)
        const block = text.substring(0, isLast ? text.length : lastNL)

        for (const xmlLine of block.split('\n')) {
          const t = xmlLine.trim()
          if (!t) continue

          if (inWorkout) {
            workoutBuf += t + '\n'
            if (t === '</Workout>' || t.startsWith('</Workout>')) {
              parseWorkoutBlock(workoutBuf, workouts, cutoffStr)
              inWorkout = false; workoutBuf = ''
            }
            continue
          }
          if (t.startsWith('<Workout ')) {
            const startM = RX_START.exec(t)
            if (!startM || startM[1].substring(0, 10) < cutoffStr) continue
            inWorkout = true; workoutBuf = t + '\n'
            if (t.endsWith('/>')) { parseWorkoutBlock(workoutBuf, workouts, cutoffStr); inWorkout = false; workoutBuf = '' }
            continue
          }

          if (!t.startsWith('<Record') && !t.startsWith('<ActivitySummary')) continue

          if (t.startsWith('<ActivitySummary')) {
            const dcM = RX_DCMP.exec(t); if (!dcM || dcM[1] < cutoffStr) continue
            const day = getOrCreate(dayMap, dcM[1])
            const ae = RX_AE.exec(t); if (ae) day.activeEnergy = Math.round(parseFloat(ae[1]))
            const ex = RX_EX.exec(t); if (ex) day.exerciseMinutes = Math.round(parseFloat(ex[1]))
            const sh = RX_SH.exec(t); if (sh) day.standHours = parseFloat(sh[1])
            continue
          }

          const typeM = RX_TYPE.exec(t); if (!typeM) continue
          const type = typeM[1]

          // ── Sleep — collect intervals for merge later ──
          const sleepStage = SLEEP_STAGE_MAP[type]
          if (sleepStage !== undefined) {
            const valM = RX_VALUE.exec(t)
            // For sleep records the value field may not be present — the type itself encodes the stage
            const sM = RX_START.exec(t); const eM = RX_END.exec(t)
            if (!sM || !eM) continue
            const start = new Date(sM[1]), end = new Date(eM[1])
            if (end <= start) continue
            // Use the wake date (end date) to attribute to the night
            const wakeDate = end.toISOString().substring(0, 10)
            if (wakeDate < cutoffStr) continue
            const arr = sleepByDate.get(wakeDate) ?? []
            arr.push({ start, end, stage: sleepStage })
            sleepByDate.set(wakeDate, arr)
            continue
          }

          // ── Quantitative ──
          const cfg = RECORD_TYPES[type]; if (!cfg) continue
          const sM = RX_START.exec(t); if (!sM) continue
          const date = sM[1].substring(0, 10)
          if (date < cutoffStr) continue
          const vM = RX_VALUE.exec(t); if (!vM) continue
          const raw = parseFloat(vM[1]); if (isNaN(raw)) continue
          const val = cfg.mult ? raw * cfg.mult : raw
          applyRecord(getOrCreate(dayMap, date), cfg.field, val, cfg.agg)
        }

        const pct = 15 + Math.round((offset / totalBytes) * 55)
        setProgress(pct)
        setLabel(`Scanning… ${Math.round((offset / totalBytes) * 100)}% (${(offset / 1024 / 1024).toFixed(0)} MB / ${(totalBytes / 1024 / 1024).toFixed(0)} MB)`)
        await new Promise(r => setTimeout(r, 0))
      }

      // ── Aggregate sleep using interval merging (fixes double-counting) ──
      setProgress(71); setLabel('Computing sleep stages…')
      for (const [date, intervals] of sleepByDate) {
        const agg = aggregateSleep(intervals)
        if (!agg) continue
        const day = getOrCreate(dayMap, date)
        day.sleepHours = Math.round(agg.totalH * 100) / 100
        if (agg.deepH > 0) day.sleepDeep = Math.round(agg.deepH * 100) / 100
        if (agg.remH  > 0) day.sleepRem  = Math.round(agg.remH  * 100) / 100
        if (agg.coreH > 0) day.sleepCore = Math.round(agg.coreH * 100) / 100
        day.sleepStart = agg.firstStart
        day.sleepEnd   = agg.lastEnd
      }

      setProgress(73); setLabel('Finalizing records…')
      const syncedAt = new Date().toISOString()
      const finalDays = Array.from(dayMap.values())
        .map(finalizeDay)
        .filter(d => Object.keys(d).length > 1)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))

      setPhase('uploading')
      const healthPath = `users/${user.uid}/health_logs`
      const workoutPath = `users/${user.uid}/workout_logs`

      setProgress(75); setLabel(`Saving ${finalDays.length} days to Firestore…`)

      const dayResults = await Promise.allSettled(
        finalDays.map(day =>
          setDocument(healthPath, String(day.date), { ...day, syncedAt })
        )
      )
      const dayOk   = dayResults.filter(r => r.status === 'fulfilled').length
      const dayFail = dayResults.filter(r => r.status === 'rejected').length
      if (dayFail > 0) {
        const firstErr = dayResults.find(r => r.status === 'rejected') as PromiseRejectedResult
        console.error('Health write error:', firstErr.reason)
      }

      setProgress(88); setLabel(`Saving ${workouts.length} workouts…`)

      const wktResults = await Promise.allSettled(
        workouts.map(w => {
          const safeStart = w.startDate.replace(/[^0-9]/g, '').substring(0, 14)
          return setDocument(workoutPath, safeStart, {
            ...w,
            endDate: w.endDate ?? w.startDate,
            duration: Math.round(w.duration ?? 0),
            calories: w.calories != null ? Math.round(w.calories) : null,
            syncedAt,
          })
        })
      )
      const wktOk = wktResults.filter(r => r.status === 'fulfilled').length

      if (dayOk === 0 && finalDays.length > 0) {
        throw new Error(`All ${finalDays.length} day records failed to save. Check your connection or Firestore permissions.`)
      }

      setResult({
        days: dayOk,
        workouts: wktOk,
        from: String(finalDays[0]?.date ?? ''),
        to: String(finalDays[finalDays.length - 1]?.date ?? ''),
      })
      setProgress(100); setLabel('Done!')
      setPhase('done')

    } catch (e: any) {
      console.error(e)
      setErrMsg(e?.message ?? 'Unknown error')
      setPhase('error')
    }
  }, [user])

  const isActive = phase === 'reading' || phase === 'parsing' || phase === 'uploading'

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '1.5rem 1rem 6rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <Link href="/health" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'none' }}>← Health Hub</Link>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.25rem 0 0.2rem' }}>📥 Import Apple Health Data</h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Parses last 30 days only · Writes directly to Firestore · Raw XML never uploaded
        </p>
      </div>

      <div style={{ background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 12, padding: '0.9rem', marginBottom: '1rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.83rem', margin: '0 0 0.4rem' }}>📱 How to export from iPhone:</p>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <li>Open <strong>Health</strong> app → tap your profile photo (top right)</li>
          <li>Scroll down → <strong>Export All Health Data</strong></li>
          <li>Wait 1–2 min → Share / Save the ZIP</li>
          <li>Upload it here — takes 30–60 sec to process</li>
        </ol>
      </div>

      {phase === 'idle' && (
        <div
          onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${isDragOver ? '#14b8a6' : 'var(--border)'}`,
            borderRadius: 16, padding: '2.5rem 2rem', textAlign: 'center', cursor: 'pointer',
            background: isDragOver ? 'rgba(20,184,166,0.05)' : 'var(--surface)', transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.6rem' }}>📦</div>
          <p style={{ fontWeight: 700, marginBottom: '0.3rem' }}>Drop export.zip here</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>or click to browse</p>
          <button style={{ background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.55rem 1.4rem', fontWeight: 700, cursor: 'pointer' }}>Choose File</button>
          <input ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        </div>
      )}

      {isActive && (
        <div className="card" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid #14b8a6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 700, margin: 0, fontSize: '0.9rem' }}>
                {phase === 'reading' ? 'Reading ZIP…' : phase === 'parsing' ? 'Parsing (last 30 days only)…' : 'Saving to Firestore…'}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{label}</p>
            </div>
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#14b8a6,#6366f1)', borderRadius: 99, transition: 'width 0.3s' }} />
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>{progress}%</p>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {phase === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="card" style={{ border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.04)' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '1.8rem' }}>✅</span>
              <div>
                <p style={{ fontWeight: 800, color: '#10b981', margin: 0 }}>Import complete!</p>
                <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>{result.from} → {result.to}</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.85rem' }}>
              {[
                { label: 'Days saved', val: result.days, icon: '📅', c: '#14b8a6' },
                { label: 'Workouts saved', val: result.workouts, icon: '🏋️', c: '#10b981' },
              ].map(x => (
                <div key={x.label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '0 0 0.15rem' }}>{x.icon} {x.label}</p>
                  <p style={{ fontWeight: 800, fontSize: '1.3rem', color: x.c, margin: 0 }}>{x.val}</p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => { window.location.href = '/health' }}
                style={{ flex: 1, background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                📊 View Health Hub
              </button>
              <button onClick={() => { setPhase('idle'); setProgress(0); setResult(null) }}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '0.6rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                Upload again
              </button>
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            💡 Export &amp; upload daily for fresh data — imports are always incremental.
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="card" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
          <p style={{ fontWeight: 700, color: '#ef4444' }}>❌ {errMsg}</p>
          <button onClick={() => { setPhase('idle'); setErrMsg('') }}
            style={{ background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.55rem 1.2rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem' }}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
