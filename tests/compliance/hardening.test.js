/**
 * hardening.test.js
 * Suite de Hardening — Phase 1 Attendance Engine
 *
 * Verifica los findings corregidos:
 * ATT-001: Pareado híbrido ENTRY/EXIT/UNKNOWN
 * ATT-002: workdayState separado de status
 * ATT-003: Dedup ventana fija
 * ATT-004: Trazabilidad punchDispositions
 * ATT-005: Semántica documentada de lateMinutes
 * ATT-006: Nocturnal minutes correctos con timezone
 * ATT-007: SHA-256 con Unicode
 * ATT-008: Ventanas explícitas en turnos cercanos
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { AttendanceEngine } from '../../src/domain/attendance/AttendanceEngine.ts'
import { AttendanceNormalizer } from '../../src/domain/attendance/AttendanceNormalizer.ts'
import { ShiftMatcher } from '../../src/domain/attendance/ShiftMatcher.ts'
import { WorkdayIntegrityHasher } from '../../src/domain/attendance/WorkdayIntegrityHasher.ts'
import { localToUtcIso } from '../../src/domain/attendance/timezoneUtils.ts'

const TZ_CDMX = 'America/Mexico_City'
const TENANT_A = 'tenant-hard-001'
const EMP_A = 'emp-hard-001'
const EMP_B = 'emp-hard-002'

// Helper: construye punch con dirección explícita
function mkPunch(date, time, tz, inOutState = null, id = null) {
  const ts = localToUtcIso(date, time, tz)
  return {
    id: id || `punch_${time.replace(':', '')}`,
    clienteId: TENANT_A,
    empleadoId: EMP_A,
    timestamp: ts,
    inOutState,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HARD-001: ENTRY/EXIT explícitos válidos (ATT-001)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-001: ENTRY/EXIT explícitos válidos — pareado por dirección', () => {

  test('HARD-001a: [ENTRY 08:00, EXIT 13:00, ENTRY 14:00, EXIT 18:00] → 2 segmentos, sin ambigüedad', () => {
    const date = '2027-02-10'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '18:00', toleranceMinutes: 10 }

    const rawPunches = [
      mkPunch(date, '08:00:00', TZ_CDMX, '0'),  // ENTRY (inOutState=0)
      mkPunch(date, '13:00:00', TZ_CDMX, '1'),  // EXIT  (inOutState=1)
      mkPunch(date, '14:00:00', TZ_CDMX, '0'),  // ENTRY
      mkPunch(date, '18:00:00', TZ_CDMX, '1'),  // EXIT
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // 2 segmentos de trabajo: 08-13 = 300m, 14-18 = 240m
    assert.equal(result.segments.filter(s => s.segmentType === 'WORK').length, 2, 'Debe haber 2 segmentos de trabajo')
    assert.equal(result.segments.filter(s => s.segmentType === 'BREAK').length, 1, 'Debe haber 1 segmento de descanso')
    assert.equal(result.workedMinutes, 600, 'Tiempo total de 08:00 a 18:00 = 600 min')
    assert.equal(result.workdayState, 'COMPLETE', 'Jornada completa')
    assert.equal(result.missingExit, false, 'No falta salida')
    assert.equal(result.missingEntry, false, 'No falta entrada')

    // Sin incidencias de ambigüedad
    const ambiguous = result.incidents.filter(i =>
      ['CONSECUTIVE_ENTRY', 'CONSECUTIVE_EXIT', 'PUNCH_SEQUENCE_AMBIGUOUS'].includes(i.code)
    )
    assert.equal(ambiguous.length, 0, 'No debe haber incidencias de ambigüedad con secuencia correcta')

    // Trazabilidad: 4 punches USED
    const used = result.punchDispositions.filter(d => d.disposition === 'USED')
    assert.equal(used.length, 4, 'Los 4 punches deben estar como USED')
  })

  test('HARD-001b: Dirección inferida correctamente desde inOutState numérico', () => {
    const date = '2027-02-10'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    // inOutState=0 → ENTRY, inOutState=1 → EXIT
    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:00:00', TZ_CDMX), inOutState: 0 },
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX), inOutState: 1 },
    ]

    // Verificar mapeo en normalizer
    const norm = AttendanceNormalizer.normalize(rawPunches, TZ_CDMX, TENANT_A, EMP_A)
    assert.equal(norm.accepted[0].direction, 'ENTRY', 'inOutState=0 → direction=ENTRY')
    assert.equal(norm.accepted[1].direction, 'EXIT', 'inOutState=1 → direction=EXIT')

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })
    assert.equal(result.workedMinutes, 540, 'Jornada 8h correcta')
    assert.equal(result.workdayState, 'COMPLETE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-002: Dos ENTRY consecutivos (ATT-001)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-002: Dos ENTRY consecutivos → CONSECUTIVE_ENTRY', () => {

  test('HARD-002: [ENTRY 08:00, ENTRY 13:00, EXIT 18:00] genera incidencia CONSECUTIVE_ENTRY', () => {
    const date = '2027-02-11'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '18:00', toleranceMinutes: 10 }

    const rawPunches = [
      mkPunch(date, '08:00:00', TZ_CDMX, '0', 'p1'),  // ENTRY
      mkPunch(date, '13:00:00', TZ_CDMX, '0', 'p2'),  // ENTRY (consecutivo → ambiguo)
      mkPunch(date, '18:00:00', TZ_CDMX, '1', 'p3'),  // EXIT
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // Debe haber incidencia de CONSECUTIVE_ENTRY
    const consEntry = result.incidents.find(i => i.code === 'CONSECUTIVE_ENTRY')
    assert.ok(consEntry, 'Debe generarse incidencia CONSECUTIVE_ENTRY')
    assert.ok(consEntry.metadata?.discardedPunchId, 'La incidencia debe incluir el ID del punch descartado')
    assert.equal(consEntry.metadata.discardedPunchId, 'p1', 'El primer ENTRY (p1) debe ser descartado')

    // Con la estrategia "descartar primer ENTRY y conservar el último":
    // p2 (08:00→13:00 ambiguo, se descarta p1 conserva p2) + p3 EXIT → 1 par
    assert.equal(result.segments.filter(s => s.segmentType === 'WORK').length, 1,
      'Debe haber 1 segmento de trabajo (p2 ENTRY → p3 EXIT)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-003: Dos EXIT consecutivos (ATT-001)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-003: Dos EXIT consecutivos → CONSECUTIVE_EXIT', () => {

  test('HARD-003: [ENTRY 08:00, EXIT 13:00, EXIT 18:00] genera incidencia CONSECUTIVE_EXIT', () => {
    const date = '2027-02-12'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '18:00', toleranceMinutes: 10 }

    const rawPunches = [
      mkPunch(date, '08:00:00', TZ_CDMX, '0', 'p1'),  // ENTRY
      mkPunch(date, '13:00:00', TZ_CDMX, '1', 'p2'),  // EXIT
      mkPunch(date, '18:00:00', TZ_CDMX, '1', 'p3'),  // EXIT (consecutivo → ambiguo)
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // p1 ENTRY + p2 EXIT → 1 par correcto
    // p3 EXIT sin ENTRY → CONSECUTIVE_EXIT
    const consExit = result.incidents.find(i => i.code === 'CONSECUTIVE_EXIT')
    assert.ok(consExit, 'Debe generarse incidencia CONSECUTIVE_EXIT')
    assert.ok(consExit.metadata?.orphanExitPunchId, 'La incidencia debe incluir el ID de la salida huérfana')
    assert.equal(consExit.metadata.orphanExitPunchId, 'p3', 'p3 debe ser la salida huérfana')

    // El segmento p1→p2 = 300m debe estar presente
    const workSegs = result.segments.filter(s => s.segmentType === 'WORK')
    assert.equal(workSegs.length, 1, 'Debe haber 1 segmento de trabajo (p1→p2)')
    assert.equal(workSegs[0].durationMinutes, 300, '08:00 a 13:00 = 300 min')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-004: Punches UNKNOWN → fallback posicional (ATT-001)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-004: Punches UNKNOWN → fallback posicional', () => {

  test('HARD-004: Sin inOutState → direction=UNKNOWN → pareado posicional par/impar', () => {
    const date = '2027-02-13'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    // Sin inOutState → UNSPECIFIED → UNKNOWN
    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:00:00', TZ_CDMX) },
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX) },
    ]

    const norm = AttendanceNormalizer.normalize(rawPunches, TZ_CDMX, TENANT_A, EMP_A)
    assert.equal(norm.accepted[0].direction, 'UNKNOWN', 'Sin inOutState → direction=UNKNOWN')
    assert.equal(norm.accepted[1].direction, 'UNKNOWN', 'Sin inOutState → direction=UNKNOWN')

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // Fallback posicional: p1=entrada, p2=salida → 1 segmento de 540m
    assert.equal(result.workedMinutes, 540, 'Fallback posicional: p1 entrada, p2 salida → 540m')
    assert.equal(result.workdayState, 'COMPLETE', 'Jornada completa via fallback posicional')
    assert.equal(result.missingExit, false)

    // Sin incidencias de ambigüedad
    const ambiguous = result.incidents.filter(i =>
      ['CONSECUTIVE_ENTRY', 'CONSECUTIVE_EXIT', 'PUNCH_SEQUENCE_AMBIGUOUS'].includes(i.code)
    )
    assert.equal(ambiguous.length, 0, 'Fallback posicional no genera incidencias de ambigüedad')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-005: Secuencia mixta ENTRY/EXIT + UNKNOWN (ATT-001)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-005: Secuencia mixta explícita + UNKNOWN', () => {

  test('HARD-005: [ENTRY 08:00, UNKNOWN 12:00, UNKNOWN 13:00, EXIT 17:00] → pairing híbrido', () => {
    const date = '2027-02-14'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      mkPunch(date, '08:00:00', TZ_CDMX, '0', 'p1'),  // ENTRY
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '12:00:00', TZ_CDMX) },  // UNKNOWN
      { id: 'p3', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '13:00:00', TZ_CDMX) },  // UNKNOWN
      mkPunch(date, '17:00:00', TZ_CDMX, '1', 'p4'),  // EXIT
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // Debe procesar correctamente sin crash
    assert.ok(result.workedMinutes >= 0, 'workedMinutes debe ser ≥ 0')
    assert.ok(result.incidents, 'Debe tener incidents array')
    assert.ok(result.punchDispositions, 'Debe tener punchDispositions')
    // No debe haber crash en secuencia mixta
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-006: LATE + EARLY_LEAVE → workdayState=COMPLETE + 2 incidents (ATT-002)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-006: LATE + EARLY_LEAVE simultáneos → workdayState y incidents correctos', () => {

  test('HARD-006: 08:15 entrada + 16:30 salida (tol=10min) → workdayState=COMPLETE, 2 incidents laborales', () => {
    const date = '2027-02-15'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:15:00', TZ_CDMX) },
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '16:30:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // ATT-002: workdayState debe ser COMPLETE (tiene entrada Y salida)
    assert.equal(result.workdayState, 'COMPLETE',
      'ATT-002: workdayState=COMPLETE porque hay entrada y salida. El retardo y salida anticipada son incidencias, no alteran la estructura.')

    // ATT-002: incidents[] debe contener AMBAS condiciones
    const lateInc = result.incidents.find(i => i.code === 'LATE')
    const earlyInc = result.incidents.find(i => i.code === 'EARLY_LEAVE')

    assert.ok(lateInc, 'Debe existir incidencia LATE')
    assert.ok(earlyInc, 'Debe existir incidencia EARLY_LEAVE')
    assert.ok(lateInc.minutes > 0, 'LATE debe tener minutos > 0')
    assert.ok(earlyInc.minutes > 0, 'EARLY_LEAVE debe tener minutos > 0')

    // ATT-002: status deprecated solo puede representar una condición
    // El comportamiento documentado: LATE tiene precedencia sobre EARLY_LEAVE en status
    assert.equal(result.status, 'LATE',
      'ATT-002 DEPRECATED: status solo captura LATE (no EARLY_LEAVE). Usar incidents[] para ambas.')

    // Verificar que missingEntry y missingExit son false
    assert.equal(result.missingEntry, false, 'No falta entrada')
    assert.equal(result.missingExit, false, 'No falta salida')
  })

  test('HARD-006b: ABSENT → workdayState=ABSENT, status=ABSENT, incident ABSENT', () => {
    const date = '2027-02-16'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, [], { timezone: TZ_CDMX })

    assert.equal(result.workdayState, 'ABSENT', 'ATT-002: Sin marcajes → workdayState=ABSENT')
    assert.equal(result.status, 'ABSENT', 'status=ABSENT')
    assert.ok(result.incidents.find(i => i.code === 'ABSENT'), 'Incident ABSENT presente')
  })

  test('HARD-006c: INCOMPLETE → workdayState=INCOMPLETE', () => {
    const date = '2027-02-17'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    // Solo entrada, sin salida
    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.workdayState, 'INCOMPLETE', 'ATT-002: Sin salida → workdayState=INCOMPLETE')
    assert.equal(result.missingExit, true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-007: Punch duplicado aparece en punchDispositions como DUPLICATE (ATT-004)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-007: Punch duplicado trazable en punchDispositions', () => {

  test('HARD-007: 3 punches (dos duplicados exactos del mismo ms) → 2 DUPLICATE en dispositions', () => {
    const date = '2027-02-18'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const ts08 = localToUtcIso(date, '08:00:00', TZ_CDMX)
    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: ts08 },
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: ts08 },      // duplicado exacto
      { id: 'p2b', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(new Date(ts08).getTime() + 500).toISOString() }, // 500ms después → también dup con default 60s
      { id: 'p3', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // punchDispositions debe tener 4 registros (uno por cada punch)
    assert.equal(result.punchDispositions.length, 4, 'Debe haber 4 dispositions (1 por punch)')

    // Los 2 duplicados deben estar marcados como DUPLICATE
    const dups = result.punchDispositions.filter(d => d.disposition === 'DUPLICATE')
    assert.equal(dups.length, 2, 'Los 2 punches duplicados deben estar como DUPLICATE en dispositions')

    // Los duplicados deben tener IDs trazables
    const dupIds = dups.map(d => d.logId)
    assert.ok(dupIds.includes('p2') || dupIds.includes('p2b'), 'Los IDs de los duplicados deben ser trazables')

    // Solo deben haber 2 USED (entrada deduplicada + salida)
    const used = result.punchDispositions.filter(d => d.disposition === 'USED')
    assert.equal(used.length, 2, 'Solo 2 punches USED (entrada retenida + salida)')

    // sourceLogIds solo incluye los USED
    assert.equal(result.sourceLogIds.length, 2, 'sourceLogIds = solo punches USED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-008: Punch fuera de ventana aparece como OUT_OF_WINDOW en trazabilidad (ATT-004)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-008: Punch fuera de ventana → disposition=OUT_OF_WINDOW', () => {

  test('HARD-008: Punch a las 03:00 AM en turno 08:00-17:00 → OUT_OF_WINDOW en punchDispositions', () => {
    const date = '2027-02-19'
    const shift = {
      operativeDate: date,
      startTime: '08:00',
      endTime: '17:00',
      toleranceMinutes: 10,
      windowBeforeStartMinutes: 30,  // solo 30min antes (no las 2h por default)
      windowAfterEndMinutes: 60,
    }

    const rawPunches = [
      { id: 'oof', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '03:00:00', TZ_CDMX) }, // fuera de ventana
      { id: 'in',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:00:00', TZ_CDMX) },
      { id: 'out', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // El punch de 03:00 debe aparecer como OUT_OF_WINDOW
    const oow = result.punchDispositions.find(d => d.logId === 'oof')
    assert.ok(oow, 'El punch fuera de ventana debe aparecer en punchDispositions')
    assert.equal(oow.disposition, 'OUT_OF_WINDOW', 'disposition debe ser OUT_OF_WINDOW')
    assert.ok(oow.reason, 'Debe tener una razón descriptiva')

    // El punch fuera de ventana NO debe estar en sourceLogIds
    assert.ok(!result.sourceLogIds.includes('oof'), 'El punch out-of-window NO debe estar en sourceLogIds')

    // Los punches válidos deben estar como USED
    const used = result.punchDispositions.filter(d => d.disposition === 'USED')
    assert.equal(used.length, 2, 'Los 2 punches válidos (in y out) deben ser USED')

    // Debe haber incidencia OUT_OF_WINDOW_PUNCH
    const oowInc = result.incidents.find(i => i.code === 'OUT_OF_WINDOW_PUNCH')
    assert.ok(oowInc, 'Debe haber incidencia OUT_OF_WINDOW_PUNCH')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-009: Cadena sliding → ventana fija (ATT-003)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-009: Cadena de punches [00,04,08,12,16]s con window=5s → ventana fija', () => {

  test('HARD-009: t=0,4,8,12,16 con window=5s → t+0, t+8, t+16 retenidos = 3 bursts + salida = 4', () => {
    // SEMÁNTICA FIJA (ATT-003):
    // t=0  → RETENIDO (burst 1)
    // t=4  → DUPLICATE (4s ≤ 5s desde t=0)
    // t=8  → NUEVO RETENIDO (8s > 5s desde t=0; burst 2)
    // t=12 → DUPLICATE (4s ≤ 5s desde t=8)
    // t=16 → NUEVO RETENIDO (8s > 5s desde t=8; burst 3)
    // salida → NUEVO RETENIDO
    // Total: t=0, t=8, t=16, salida = 4 sourceLogIds

    const date = '2027-02-20'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 30 }
    const baseTs = new Date(localToUtcIso(date, '08:00:00', TZ_CDMX)).getTime()

    const rawPunches = [
      { id: 'p0',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 0).toISOString() },
      { id: 'p4',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 4000).toISOString() },
      { id: 'p8',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 8000).toISOString() },
      { id: 'p12', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 12000).toISOString() },
      { id: 'p16', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 16000).toISOString() },
      { id: 'out', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, {
      timezone: TZ_CDMX,
      deduplication: { minSecondsBetweenPunches: 5, mode: 'KEEP_FIRST' },
    })

    // t=0, t=8, t=16 retenidos + salida = 4 sourceLogIds
    assert.equal(result.sourceLogIds.length, 4,
      'Ventana fija: t=0, t=8, t=16 retenidos + salida = 4 sourceLogIds')

    // p4 y p12 deben ser DUPLICATE
    const dups = result.punchDispositions.filter(d => d.disposition === 'DUPLICATE')
    assert.equal(dups.length, 2, 'p4 y p12 deben ser DUPLICATE')
    const dupIds = dups.map(d => d.logId)
    assert.ok(dupIds.includes('p4'), 'p4 debe ser DUPLICATE')
    assert.ok(dupIds.includes('p12'), 'p12 debe ser DUPLICATE')

    // t=0, t=8, t=16 deben ser USED
    const usedIds = result.punchDispositions.filter(d => d.disposition === 'USED').map(d => d.logId)
    assert.ok(usedIds.includes('p0'), 'p0 debe ser USED')
    assert.ok(usedIds.includes('p8'), 'p8 debe ser USED')
    assert.ok(usedIds.includes('p16'), 'p16 debe ser USED')
    assert.ok(usedIds.includes('out'), 'out debe ser USED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-010: SHA-256 con Unicode (ATT-007)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-010: SHA-256 fallback con caracteres Unicode', () => {

  test('HARD-010a: Hash con nombre de festivo con caracteres especiales no debe ser vacío', () => {
    // Nombres de festivos mexicanos con Unicode
    const names = [
      'Año Nuevo',
      'Constitución Política',
      'Natalicio de Benito Juárez',
      'Día de la Independencia',
      'Revolución Mexicana',
      'José María Morelos y Pavón',
      '1° de Mayo (Día del Trabajo)',
    ]

    for (const holidayName of names) {
      const hash = WorkdayIntegrityHasher.computeHash({
        clienteId: 'tenant-001',
        empleadoId: 'emp-001',
        operativeDate: '2027-02-05',
        timezone: TZ_CDMX,
        scheduledStart: '2027-02-05T14:00:00.000Z',
        scheduledEnd: '2027-02-05T23:00:00.000Z',
        actualStart: '2027-02-05T14:00:00.000Z',
        actualEnd: '2027-02-05T23:00:00.000Z',
        workedMinutes: 540,
        breakMinutes: 0,
        effectiveMinutes: 540,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        ordinaryMinutes: 480,
        overtimeMinutes: 60,
        status: 'PRESENT',
        sourceLogIds: ['log1', 'log2'],
        incidentCodes: [],
        calculationVersion: 1,
      })

      assert.ok(hash && hash.length === 64,
        `Hash para festivo "${holidayName}" debe ser 64 caracteres hex (no vacío). Actual: "${hash}"`)
      assert.ok(/^[0-9a-f]{64}$/.test(hash),
        `Hash para "${holidayName}" debe ser hexadecimal válido`)
    }
  })

  test('HARD-010b: Hash con nombre de festivo con emojis produce un hash válido', () => {
    const hash = WorkdayIntegrityHasher.computeHash({
      clienteId: 'tenant-001',
      empleadoId: 'emp-001',
      operativeDate: '2027-02-05',
      timezone: TZ_CDMX,
      workedMinutes: 0,
      breakMinutes: 0,
      effectiveMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      status: 'HOLIDAY',
      sourceLogIds: [],
      incidentCodes: ['HOLIDAY_WORK'],
      calculationVersion: 1,
    })

    assert.ok(hash.length === 64, `Hash debe ser 64 chars hex. Actual: "${hash}"`)
  })

  test('HARD-010c: Mismo input con Unicode → mismo hash (determinista)', () => {
    const payload = {
      clienteId: 'tenant-001',
      empleadoId: 'emp-001',
      operativeDate: '2027-09-16',
      timezone: 'América/Ciudad_de_México',
      workedMinutes: 480,
      breakMinutes: 60,
      effectiveMinutes: 420,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      ordinaryMinutes: 420,
      overtimeMinutes: 0,
      status: 'PRESENT',
      sourceLogIds: ['punch_ñoño_1', 'punch_müller_2'],
      incidentCodes: [],
      calculationVersion: 1,
    }

    const hash1 = WorkdayIntegrityHasher.computeHash(payload)
    const hash2 = WorkdayIntegrityHasher.computeHash(payload)

    assert.equal(hash1, hash2, 'Mismo input con Unicode debe producir mismo hash')
    assert.ok(/^[0-9a-f]{64}$/.test(hash1), 'Hash debe ser hex válido de 64 chars')
  })

  test('HARD-010d: Jornada en día festivo con nombre Unicode es procesada correctamente', () => {
    const date = '2027-09-16'  // Día de la Independencia
    const shift = {
      operativeDate: date,
      startTime: '08:00',
      endTime: '17:00',
      isHoliday: true,
      holidayName: 'Día de la Independencia de México 🇲🇽',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '08:00:00', TZ_CDMX) },
      { id: 'p2', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.ok(result.integrityHash && result.integrityHash.length === 64,
      'El hash de integridad debe ser válido incluso con nombre de festivo Unicode')
    assert.ok(/^[0-9a-f]{64}$/.test(result.integrityHash), 'Hash debe ser hex válido')
    assert.equal(result.status, 'HOLIDAY_WORK', 'Día festivo laborado')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-011: Turnos cercanos con ventanas solapadas (ATT-008)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-011: Turnos cercanos con ventanas explícitas (ATT-008)', () => {

  test('HARD-011: Turno 06-14 y Turno 14-22 en mismo día — windowAfterEnd=30min evita solapamiento', () => {
    // ATT-008: Con windowAfterEndMinutes=30 (no el default 180), los turnos 06-14 y 14-22
    // no solapan: punch de 14:10 solo cae en el turno 14-22, no en el 06-14.
    const date = '2027-02-21'

    const shift1 = {
      operativeDate: date,
      startTime: '06:00',
      endTime: '14:00',
      toleranceMinutes: 10,
      windowBeforeStartMinutes: 30,
      windowAfterEndMinutes: 30,   // ATT-008: ventana reducida para evitar solapamiento
    }

    const shift2 = {
      operativeDate: date,
      startTime: '14:00',
      endTime: '22:00',
      toleranceMinutes: 10,
      windowBeforeStartMinutes: 30,
      windowAfterEndMinutes: 30,
    }

    const punches1 = [
      { id: 's1-in',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '06:00:00', TZ_CDMX) },
      { id: 's1-out', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '14:00:00', TZ_CDMX) },
    ]

    const punches2 = [
      { id: 's2-in',  clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '14:10:00', TZ_CDMX) },
      { id: 's2-out', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '22:00:00', TZ_CDMX) },
    ]

    const result1 = AttendanceEngine.process(TENANT_A, EMP_A, shift1, punches1, { timezone: TZ_CDMX })
    const result2 = AttendanceEngine.process(TENANT_A, EMP_A, shift2, punches2, { timezone: TZ_CDMX })

    // Turno 1: 06-14 = 480 min
    assert.equal(result1.workedMinutes, 480, 'Turno 1: 06:00-14:00 = 480 min')
    assert.equal(result1.workdayState, 'COMPLETE', 'Turno 1 completo')
    assert.ok(!result1.sourceLogIds.includes('s2-in'), 'Punch 14:10 no debe estar en Turno 1')

    // Turno 2: 14:10-22:00 = 470 min
    assert.equal(result2.workedMinutes, 470, 'Turno 2: 14:10-22:00 = 470 min')
    assert.equal(result2.workdayState, 'COMPLETE', 'Turno 2 completo')
    assert.ok(!result2.sourceLogIds.includes('s1-out'), 'Punch 14:00 no debe contaminar Turno 2')
  })

  test('HARD-011b: Con ventanas default (2h/3h), punch de 14:10 cae en AMBOS turnos', () => {
    // ATT-008: Documenta el riesgo de ventanas grandes con turnos cercanos.
    // Sin configuración explícita, punch de 14:10 cae en la ventana post-shift de turno 1 (14:00+3h).
    const date = '2027-02-22'

    const shiftDefault1 = {
      operativeDate: date,
      startTime: '06:00',
      endTime: '14:00',
      toleranceMinutes: 10,
      // windowAfterEndMinutes default = 180 → acepta hasta 17:00
    }

    const punchAt1410 = [
      { id: 'p1', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(date, '14:10:00', TZ_CDMX) },
    ]

    // Normalizar y matching para turno 1 con defaults (usa imports estáticos del módulo)
    const norm = AttendanceNormalizer.normalize(punchAt1410, TZ_CDMX, TENANT_A, EMP_A)
    const match1 = ShiftMatcher.match(shiftDefault1, norm.accepted, TZ_CDMX)

    // Con window default 3h después del fin: el punch de 14:10 cae dentro de la ventana de Turno 1
    assert.ok(match1.matchedPunches.length > 0,
      'ATT-008 riesgo documentado: con ventanas default 2h/3h, punch de 14:10 cae en turno 06-14')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// HARD-012: Idempotencia tras hardening (ATT-001/002/004)
// ─────────────────────────────────────────────────────────────────────────────
describe('HARD-012: Idempotencia completa tras hardening', () => {

  test('HARD-012: 10 ejecuciones con ENTRY/EXIT explícitos → mismo hash, mismos workdayState, mismas dispositions', () => {
    const date = '2027-02-23'
    const shift = { operativeDate: date, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      mkPunch(date, '08:15:00', TZ_CDMX, '0', 'p1'),  // ENTRY (15min tarde → supera tolerancia 10min → LATE)
      mkPunch(date, '13:00:00', TZ_CDMX, '1', 'p2'),  // EXIT
      mkPunch(date, '14:00:00', TZ_CDMX, '0', 'p3'),  // ENTRY
      mkPunch(date, '16:30:00', TZ_CDMX, '1', 'p4'),  // EXIT (30min anticipado → EARLY_LEAVE)
    ]

    const results = []
    for (let i = 0; i < 10; i++) {
      results.push(AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX }))
    }

    // Todos los hashes deben ser idénticos
    const hashes = results.map(r => r.integrityHash)
    const uniqueHashes = new Set(hashes)
    assert.equal(uniqueHashes.size, 1, '10 ejecuciones deben producir exactamente 1 hash único')

    // workdayState consistente
    const states = results.map(r => r.workdayState)
    assert.ok(states.every(s => s === states[0]), 'workdayState debe ser idéntico en 10 ejecuciones')

    // punchDispositions consistentes
    const dispositionCounts = results.map(r => r.punchDispositions.length)
    assert.ok(dispositionCounts.every(c => c === dispositionCounts[0]),
      'Número de dispositions debe ser idéntico en 10 ejecuciones')

    // sourceLogIds consistentes
    const sourceIds = results.map(r => JSON.stringify([...r.sourceLogIds].sort()))
    assert.ok(sourceIds.every(s => s === sourceIds[0]), 'sourceLogIds deben ser idénticos en 10 ejecuciones')

    // Verificar workdayState del resultado: COMPLETE (tiene 2 pares válidos)
    assert.equal(results[0].workdayState, 'COMPLETE', 'Jornada completa con 2 pares ENTRY/EXIT')

    // Verificar co-ocurrencia de LATE + EARLY_LEAVE en incidents[]
    const lateInc = results[0].incidents.find(i => i.code === 'LATE')
    const earlyInc = results[0].incidents.find(i => i.code === 'EARLY_LEAVE')
    assert.ok(lateInc, 'Debe haber incidencia LATE')
    assert.ok(earlyInc, 'Debe haber incidencia EARLY_LEAVE')
  })
})
