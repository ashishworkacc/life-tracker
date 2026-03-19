'use client'

import { useState, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DailyRecord {
  date: string  // YYYY-MM-DD
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
  // aggregation helpers (not sent to API)
  _hrSum?: number; _hrCount?: number
  _hrvSum?: number; _hrvCount?: number
  _spo2Sum?: number; _spo2Count?: number
  _rrSum?: number; _rrCount?: number
  _bpSysSum?: number; _bpSysCount?: number
  _bpDiaSum?: number; _bpDiaCount?: number
  _restingHrSum?: number; _restingHrCount?: number
}

interface ImportSummary {
  totalDays: number
  dateRange: { from: string; to: string }
  metricsFound: string[]
  weightDays: number
  bodyFatDays: number
  sleepDays: number
  activityDays: number
  hrvDays: number
}

// ─── Apple Health metric map ───────────────────────────────────────────────────
const RECORD_TYPES: Record<string, { field: string; agg: 'last' | 'sum' | 'avg'; mult?: number }> = {
  HKQuantityTypeIdentifierBodyMass:             { field: 'weight',        agg: 'last' },
  HKQuantityTypeIdentifierBodyFatPercentage:    { field: 'bodyFat',       agg: 'last', mult: 100 }, // stored 0-1
  HKQuantityTypeIdentifierLeanBodyMass:         { field: 'leanMass',      agg: 'last' },
  HKQuantityTypeIdentifierBodyMassIndex:        { field: 'bmi',           agg: 'last' },
  HKQuantityTypeIdentifierVO2Max:               { field: 'vo2Max',        agg: 'last' },
  HKQuantityTypeIdentifierRestingHeartRate:     { field: '_restingHr',    agg: 'avg' },
  HKQuantityTypeIdentifierHeartRate:            { field: '_hr',           agg: 'avg' },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { field: '_hrv',      agg: 'avg' },
  HKQuantityTypeIdentifierOxygenSaturation:     { field: '_spo2',         agg: 'avg', mult: 100 },
  HKQuantityTypeIdentifierRespiratoryRate:      { field: '_rr',           agg: 'avg' },
  HKQuantityTypeIdentifierStepCount:            { field: 'steps',         agg: 'sum' },
  HKQuantityTypeIdentifierActiveEnergyBurned:   { field: 'activeEnergy',  agg: 'sum' },
  HKQuantityTypeIdentifierBasalEnergyBurned:    { field: 'restingEnergy', agg: 'sum' },
  HKQuantityTypeIdentifierAppleExerciseTime:    { field: 'exerciseMinutes', agg: 'sum' },
  HKQuantityTypeIdentifierAppleStandTime:       { field: '_standMin',     agg: 'sum' },
  HKQuantityTypeIdentifierBloodPressureSystolic: { field: '_bpSys',       agg: 'avg' },
  HKQuantityTypeIdentifierBloodPressureDiastolic: { field: '_bpDia',      agg: 'avg' },
}

// Sleep value types that count as "asleep" (not in-bed, not awake)
const ASLEEP_VALUES = new Set([
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
  'HKCategoryValueSleepAnalysisAsleepCore',
])
const DEEP_VALUE = 'HKCategoryValueSleepAnalysisAsleepDeep'
const REM_VALUE  = 'HKCategoryValueSleepAnalysisAsleepREM'
const CORE_VALUE = 'HKCategoryValueSleepAnalysisAsleepCore'

// ─── Regex parsers (fast, no DOM needed) ─────────────────────────────────────
const RX_TYPE      = /type="([^"]+)"/
const RX_VALUE     = /\bvalue="([^"]+)"/
const RX_START     = /startDate="([^"]+)"/
const RX_END       = /endDate="([^"]+)"/
const RX_DATE_COMP = /dateComponents="([^"]+)"/
const RX_ACT_ENERGY     = /activeEnergyBurned="([^"]+)"/
const RX_EX_TIME        = /appleExerciseTime="([^"]+)"/
const RX_STAND_HOURS    = /appleStandHours="([^"]+)"/
const RX_MOVE_GOAL      = /activeEnergyBurnedGoal="([^"]+)"/
const RX_EX_GOAL        = /appleExerciseTimeGoal="([^"]+)"/
const RX_STAND_GOAL     = /appleStandHoursGoal="([^"]+)"/

function isoToDate(dateStr: string): string {
  // "2025-05-14 15:17:59 +0530" → "2025-05-14"
  return dateStr.substring(0, 10)
}

function getOrCreate(map: Map<string, DailyRecord>, date: string): DailyRecord {
  if (!map.has(date)) map.set(date, { date })
  return map.get(date)!
}

function applyRecord(day: DailyRecord, field: string, value: number, agg: 'last' | 'sum' | 'avg') {
  if (agg === 'last') {
    (day as any)[field] = value
  } else if (agg === 'sum') {
    (day as any)[field] = ((day as any)[field] ?? 0) + value
  } else {
    // avg: accumulate sum+count
    const sumKey = field + 'Sum'
    const cntKey = field + 'Count';
    (day as any)[sumKey] = ((day as any)[sumKey] ?? 0) + value;
    (day as any)[cntKey] = ((day as any)[cntKey] ?? 0) + 1
  }
}

function finalizeDay(day: DailyRecord): DailyRecord {
  const d = { ...day }
  // Compute averages
  const avgFields: [string, string][] = [
    ['_hr', 'heartRateAvg'], ['_restingHr', 'heartRateResting'],
    ['_hrv', 'hrv'], ['_spo2', 'spo2'], ['_rr', 'respiratoryRate'],
    ['_bpSys', 'bloodPressureSystolic'], ['_bpDia', 'bloodPressureDiastolic'],
  ]
  for (const [prefix, out] of avgFields) {
    const sum = (d as any)[prefix + 'Sum']
    const cnt = (d as any)[prefix + 'Count']
    if (sum !== undefined && cnt > 0) (d as any)[out] = Math.round((sum / cnt) * 10) / 10
  }
  // Convert stand minutes → hours
  if ((d as any)._standMinSum !== undefined && (d as any)._standMinCount > 0) {
    d.standHours = Math.round(((d as any)._standMinSum / (d as any)._standMinCount) / 60 * 10) / 10
  }
  // Round floats
  if (d.bodyFat !== undefined) d.bodyFat = Math.round(d.bodyFat * 10) / 10
  if (d.weight !== undefined)  d.weight  = Math.round(d.weight * 100) / 100
  if (d.steps !== undefined)   d.steps   = Math.round(d.steps)
  if (d.activeEnergy !== undefined) d.activeEnergy = Math.round(d.activeEnergy)
  if (d.restingEnergy !== undefined) d.restingEnergy = Math.round(d.restingEnergy)
  if (d.exerciseMinutes !== undefined) d.exerciseMinutes = Math.round(d.exerciseMinutes)
  if (d.sleepHours !== undefined) d.sleepHours = Math.round(d.sleepHours * 100) / 100
  if (d.sleepDeep !== undefined) d.sleepDeep = Math.round(d.sleepDeep * 100) / 100
  if (d.sleepRem !== undefined)  d.sleepRem  = Math.round(d.sleepRem * 100) / 100
  // Remove internal accumulator fields
  const clean: DailyRecord = { date: d.date }
  const KEEP_FIELDS = ['weight','bodyFat','leanMass','bmi','heartRateResting','heartRateAvg',
    'hrv','vo2Max','spo2','respiratoryRate','steps','activeEnergy','restingEnergy',
    'exerciseMinutes','standHours','sleepHours','sleepDeep','sleepRem','sleepCore',
    'bloodPressureSystolic','bloodPressureDiastolic']
  for (const f of KEEP_FIELDS) {
    if ((d as any)[f] !== undefined) (clean as any)[f] = (d as any)[f]
  }
  return clean
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function HealthImportPage() {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'parsing' | 'uploading' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [uploadedDays, setUploadedDays] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)

  const processFile = useCallback(async (file: File) => {
    if (!user) return
    if (!file.name.endsWith('.zip')) {
      setErrorMsg('Please upload the export.zip file from Apple Health → Export All Health Data.')
      setPhase('error')
      return
    }

    try {
      // ── 1. Read ZIP ──────────────────────────────────────────────────────────
      setPhase('reading')
      setProgress(2)
      setProgressLabel('Reading ZIP file…')

      const JSZip = (await import('jszip')).default
      const arrayBuffer = await file.arrayBuffer()
      setProgress(8)
      setProgressLabel('Extracting ZIP…')

      const zip = await JSZip.loadAsync(arrayBuffer)
      setProgress(12)

      // Find export.xml inside the zip (handles apple_health_export/export.xml)
      const xmlEntry = zip.file(/export\.xml$/)[0]
      if (!xmlEntry) {
        throw new Error('No export.xml found inside the ZIP. Make sure you export from iPhone → Health → Profile → Export All Health Data.')
      }

      setProgressLabel(`Found ${xmlEntry.name} — decompressing…`)
      setProgress(15)

      // ── 2. Decompress XML as text (streaming via arraybuffer chunks) ─────────
      setPhase('parsing')
      const xmlText = await xmlEntry.async('text')
      setProgress(35)
      setProgressLabel(`Parsing ${(xmlText.length / 1024 / 1024).toFixed(0)} MB of health records…`)

      // ── 3. Parse line-by-line ────────────────────────────────────────────────
      const dayMap = new Map<string, DailyRecord>()

      // Sleep intervals: [startDate, endDate, sleepType]
      const sleepIntervals: Array<[Date, Date, string]> = []

      const lines = xmlText.split('\n')
      const totalLines = lines.length
      let processed = 0

      // Process in chunks of 10000 lines to keep UI responsive
      const CHUNK = 10000
      for (let start = 0; start < totalLines; start += CHUNK) {
        const end = Math.min(start + CHUNK, totalLines)
        for (let i = start; i < end; i++) {
          const line = lines[i]
          if (!line.includes('<Record') && !line.includes('<ActivitySummary')) continue

          if (line.includes('<ActivitySummary')) {
            const dcMatch = RX_DATE_COMP.exec(line)
            if (!dcMatch) continue
            const date = dcMatch[1] // "2025-05-14"
            const day = getOrCreate(dayMap, date)
            const ae = RX_ACT_ENERGY.exec(line); if (ae) day.activeEnergy = Math.round(parseFloat(ae[1]))
            const ex = RX_EX_TIME.exec(line);    if (ex) day.exerciseMinutes = Math.round(parseFloat(ex[1]))
            const sh = RX_STAND_HOURS.exec(line); if (sh) day.standHours = parseFloat(sh[1])
            continue
          }

          if (!line.includes('<Record')) continue
          const typeMatch = RX_TYPE.exec(line)
          if (!typeMatch) continue
          const type = typeMatch[1]

          // Sleep analysis — handled separately
          if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
            const valMatch  = RX_VALUE.exec(line)
            const startMatch = RX_START.exec(line)
            const endMatch   = RX_END.exec(line)
            if (!valMatch || !startMatch || !endMatch) continue
            const sleepVal = valMatch[1]
            if (ASLEEP_VALUES.has(sleepVal)) {
              sleepIntervals.push([new Date(startMatch[1]), new Date(endMatch[1]), sleepVal])
            }
            continue
          }

          const cfg = RECORD_TYPES[type]
          if (!cfg) continue

          const valMatch  = RX_VALUE.exec(line)
          const startMatch = RX_START.exec(line)
          if (!valMatch || !startMatch) continue

          const date = isoToDate(startMatch[1])
          const rawVal = parseFloat(valMatch[1])
          if (isNaN(rawVal)) continue

          const value = cfg.mult ? rawVal * cfg.mult : rawVal
          const day = getOrCreate(dayMap, date)
          applyRecord(day, cfg.field, value, cfg.agg)
        }

        processed = end
        const pct = 35 + Math.round((processed / totalLines) * 40)
        setProgress(pct)
        setProgressLabel(`Parsing records… ${Math.round((processed / totalLines) * 100)}% (${(processed / 1000).toFixed(0)}k / ${(totalLines / 1000).toFixed(0)}k lines)`)

        // Yield to UI thread
        await new Promise(r => setTimeout(r, 0))
      }

      // ── 4. Aggregate sleep intervals by date ─────────────────────────────────
      setProgressLabel('Computing sleep intervals…')
      for (const [start, end, sleepType] of sleepIntervals) {
        if (end <= start) continue
        const durationHours = (end.getTime() - start.getTime()) / 3600000
        // Attribute sleep to the date of the *end* (morning of the sleep session)
        const date = isoToDate(end.toISOString())
        const day = getOrCreate(dayMap, date)
        day.sleepHours = (day.sleepHours ?? 0) + durationHours
        if (sleepType === DEEP_VALUE) day.sleepDeep = (day.sleepDeep ?? 0) + durationHours
        if (sleepType === REM_VALUE)  day.sleepRem  = (day.sleepRem  ?? 0) + durationHours
        if (sleepType === CORE_VALUE) day.sleepCore = (day.sleepCore ?? 0) + durationHours
      }

      // ── 5. Finalize all days ─────────────────────────────────────────────────
      setProgress(76)
      setProgressLabel('Finalizing records…')
      const finalDays = Array.from(dayMap.values())
        .map(finalizeDay)
        .filter(d => Object.keys(d).length > 1) // at least one metric
        .sort((a, b) => a.date.localeCompare(b.date))

      // Build summary
      const metricsFound = new Set<string>()
      let weightDays = 0, bodyFatDays = 0, sleepDays = 0, activityDays = 0, hrvDays = 0
      for (const d of finalDays) {
        if (d.weight)     { metricsFound.add('Weight'); weightDays++ }
        if (d.bodyFat)    { metricsFound.add('Body Fat %'); bodyFatDays++ }
        if (d.sleepHours) { metricsFound.add('Sleep'); sleepDays++ }
        if (d.steps)      { metricsFound.add('Steps'); activityDays++ }
        if (d.hrv)        { metricsFound.add('HRV'); hrvDays++ }
        if (d.heartRateResting) metricsFound.add('Resting HR')
        if (d.heartRateAvg)     metricsFound.add('Heart Rate')
        if (d.vo2Max)           metricsFound.add('VO₂ Max')
        if (d.activeEnergy)     metricsFound.add('Active Calories')
        if (d.exerciseMinutes)  metricsFound.add('Exercise Minutes')
        if (d.bloodPressureSystolic) metricsFound.add('Blood Pressure')
      }

      const importSummary: ImportSummary = {
        totalDays: finalDays.length,
        dateRange: { from: finalDays[0]?.date ?? '', to: finalDays[finalDays.length - 1]?.date ?? '' },
        metricsFound: Array.from(metricsFound),
        weightDays, bodyFatDays, sleepDays, activityDays, hrvDays,
      }

      // ── 6. Upload in batches of 60 days ─────────────────────────────────────
      setPhase('uploading')
      setProgress(78)
      const BATCH = 60
      let uploaded = 0
      for (let i = 0; i < finalDays.length; i += BATCH) {
        const batch = finalDays.slice(i, i + BATCH)
        await fetch('/api/health/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, records: batch }),
        })
        uploaded += batch.length
        setUploadedDays(uploaded)
        const pct = 78 + Math.round((uploaded / finalDays.length) * 20)
        setProgress(pct)
        setProgressLabel(`Uploading… ${uploaded} / ${finalDays.length} days`)
        await new Promise(r => setTimeout(r, 50))
      }

      setSummary(importSummary)
      setProgress(100)
      setProgressLabel('Done!')
      setPhase('done')

    } catch (e: any) {
      console.error(e)
      setErrorMsg(e?.message ?? 'Unknown error. Check the console for details.')
      setPhase('error')
    }
  }, [user])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const isActive = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1rem 6rem' }}>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <Link href="/health" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>← Health Hub</Link>
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>📥 Import Apple Health Data</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
          Upload your Apple Health export ZIP · Parsed entirely in your browser · Nothing leaves your device until uploaded
        </p>
      </div>

      {/* How to export */}
      <div style={{ background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 12, padding: '1rem', marginBottom: '1.25rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>📱 How to export from your iPhone:</p>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {[
            'Open the Health app on iPhone',
            'Tap your profile photo (top right)',
            'Scroll down → tap "Export All Health Data"',
            'Wait for it to prepare (may take 1–2 min for large exports)',
            'Share / Save the ZIP file, then upload it here',
          ].map((s, i) => (
            <li key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s}</li>
          ))}
        </ol>
      </div>

      {/* Upload dropzone */}
      {phase === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragOver ? '#14b8a6' : 'var(--border)'}`,
            borderRadius: 16,
            padding: '3rem 2rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: isDragOver ? 'rgba(20,184,166,0.05)' : 'var(--surface)',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📦</div>
          <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.35rem' }}>Drop export.zip here</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
            or click to browse · ZIP files only · typically 200–800 MB
          </p>
          <button style={{
            background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8,
            padding: '0.6rem 1.5rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
          }}>
            Choose File
          </button>
          <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      )}

      {/* Progress */}
      {isActive && (
        <div className="card" style={{ border: '1px solid rgba(20,184,166,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #14b8a6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            <div>
              <p style={{ fontWeight: 700, margin: 0 }}>
                {phase === 'reading' ? 'Reading file…' : phase === 'parsing' ? 'Parsing health records…' : 'Uploading to Firestore…'}
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{progressLabel}</p>
            </div>
          </div>
          <div style={{ background: 'var(--surface-2)', borderRadius: 99, height: 10, overflow: 'hidden', marginBottom: '0.5rem' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #14b8a6, #6366f1)', borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>{progress}%</p>
          {phase === 'uploading' && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Saving {uploadedDays} days to your health database…
            </p>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Success */}
      {phase === 'done' && summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card" style={{ border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '2rem' }}>✅</span>
              <div>
                <p style={{ fontWeight: 800, fontSize: '1.05rem', margin: 0, color: '#10b981' }}>Import complete!</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  {summary.totalDays} days imported · {summary.dateRange.from} → {summary.dateRange.to}
                </p>
              </div>
            </div>

            {/* Metric breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
              {[
                { label: 'Days with Weight', val: summary.weightDays, icon: '⚖️', color: '#8b5cf6' },
                { label: 'Days with Body Fat', val: summary.bodyFatDays, icon: '📊', color: '#ec4899' },
                { label: 'Days with Sleep', val: summary.sleepDays, icon: '💤', color: '#6366f1' },
                { label: 'Days with Activity', val: summary.activityDays, icon: '🏃', color: '#10b981' },
                { label: 'Days with HRV', val: summary.hrvDays, icon: '❤️', color: '#ef4444' },
              ].map(item => (
                <div key={item.label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '0 0 0.15rem' }}>{item.icon} {item.label}</p>
                  <p style={{ fontWeight: 800, fontSize: '1.1rem', color: item.color, margin: 0 }}>{item.val}</p>
                </div>
              ))}
            </div>

            {/* Metrics found */}
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Metrics imported:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {summary.metricsFound.map(m => (
                  <span key={m} style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)', color: '#14b8a6', borderRadius: 99, padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 600 }}>
                    ✓ {m}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link href="/health" style={{ flex: 1, textAlign: 'center', background: '#14b8a6', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '0.65rem', fontWeight: 700, fontSize: '0.85rem' }}>
                📊 View Health Hub
              </Link>
              <button onClick={() => { setPhase('idle'); setProgress(0); setSummary(null) }}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '0.65rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                📥 Import another file
              </button>
            </div>
          </div>

          {/* Tip about recurring imports */}
          <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '0.85rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.3rem', color: '#f59e0b' }}>💡 Keep your data fresh</p>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Export from Apple Health every week or month and re-upload here — the import is incremental (new days are added, existing days are updated).
              Previous imports are never deleted.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="card" style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.5rem' }}>❌ Import failed</p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{errorMsg}</p>
          <button onClick={() => { setPhase('idle'); setErrorMsg('') }}
            style={{ background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      )}

      {/* What gets imported */}
      {phase === 'idle' && (
        <div style={{ marginTop: '1.25rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>📋 What gets imported from your export.zip:</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.35rem' }}>
            {[
              ['⚖️', 'Weight (kg)'],
              ['📊', 'Body Fat %'],
              ['💪', 'Lean Body Mass'],
              ['🫀', 'BMI'],
              ['❤️', 'Resting Heart Rate'],
              ['📈', 'Avg Heart Rate'],
              ['🧘', 'HRV (recovery)'],
              ['🫁', 'VO₂ Max'],
              ['🩺', 'SpO₂'],
              ['🌬️', 'Respiratory Rate'],
              ['👟', 'Step Count'],
              ['🔥', 'Active Calories'],
              ['🏋️', 'Exercise Minutes'],
              ['🕐', 'Stand Hours'],
              ['💤', 'Sleep (total/deep/REM)'],
              ['💊', 'Blood Pressure'],
            ].map(([icon, label]) => (
              <div key={label} style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0' }}>
                <span>{icon}</span><span style={{ color: 'var(--text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            All data is aggregated per day and stored in your private Firestore database. Parsing happens entirely in your browser — your raw XML never leaves your device.
          </p>
        </div>
      )}
    </div>
  )
}
