/**
 * tests/compliance/adversarial.test.js
 *
 * Suite adversarial independiente — Auditoría Técnica Fase 1
 * Módulo: Cumplimiento Laboral México 2027
 *
 * Objetivo: Intentar activamente romper el Attendance Engine en casos límite,
 * condiciones de frontera, estados inválidos y escenarios de producción reales.
 *
 * Ejecutar: node --test tests/compliance/adversarial.test.js
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  AttendanceEngine,
  AttendanceNormalizer,
  ShiftMatcher,
  WorkdayCalculator,
  WorkdayIntegrityHasher,
  IncidentDetector,
  localToUtcIso,
  getLocalComponents,
  TenantMismatchError,
  InvalidTimezoneError,
  InvalidPunchError,
  DefaultLaborRuleProvider,
} from '../../src/domain/attendance/index.ts'

const TENANT_A = 'tenant_adversarial_a'
const TENANT_B = 'tenant_adversarial_b'
const EMP_A = 'emp_adversarial_001'
const EMP_B = 'emp_adversarial_002'
const TZ_CDMX = 'America/Mexico_City'
const TZ_CANCUN = 'America/Cancun'

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 1: ORDEN DE CHECADAS
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-A: Orden de marcajes', () => {

  test('ADV-A1: Input desordenado [17:00, 08:00] debe normalizarse y producir 540m', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    // Entrada en orden INVERSO
    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // Debe normalizar y producir 540 minutos identicos al input ordenado
    assert.equal(result.workedMinutes, 540, 'Input desordenado debe producir mismos workedMinutes que ordenado')
    assert.equal(result.lateMinutes, 0)
    assert.equal(result.earlyLeaveMinutes, 0)
    assert.equal(result.status, 'PRESENT')
  })

  test('ADV-A2: Input 4 marcajes desordenados [14:00, 08:00, 18:00, 13:00] = mismo resultado que ordenado', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '18:00', hasBreak: true, scheduledBreakMinutes: 60 }

    const ordered = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '13:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '14:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '18:00:00', TZ_CDMX) },
    ]

    const disordered = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '14:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '18:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '13:00:00', TZ_CDMX) },
    ]

    const opts = { timezone: TZ_CDMX, deduplication: { minSecondsBetweenPunches: 0 } }
    const r1 = AttendanceEngine.process(TENANT_A, EMP_A, shift, ordered, opts)
    const r2 = AttendanceEngine.process(TENANT_A, EMP_A, shift, disordered, opts)

    assert.equal(r1.workedMinutes, r2.workedMinutes, 'workedMinutes debe ser igual independiente del orden de input')
    assert.equal(r1.breakMinutes, r2.breakMinutes, 'breakMinutes debe ser igual')
    assert.equal(r1.effectiveMinutes, r2.effectiveMinutes, 'effectiveMinutes debe ser igual')
    assert.equal(r1.status, r2.status)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 2: MISMO TIMESTAMP — DOS IDs DIFERENTES
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-B: Mismo timestamp, IDs distintos', () => {

  test('ADV-B1: Dos events en mismo epoch ms pero con IDs diferentes — dedup debe ser determinista', () => {
    const operativeDate = '2027-01-15'
    const ts = localToUtcIso(operativeDate, '08:00:00', TZ_CDMX)
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const rawPunches = [
      { id: 'log-001', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: ts },
      { id: 'log-002', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: ts },  // mismo ts, diferente id
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const r1 = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })
    const r2 = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // Comportamiento determinista — mismo resultado en ambas ejecuciones
    assert.equal(r1.integrityHash, r2.integrityHash, 'Hash debe ser idéntico en ejecuciones repetidas con mismo input')
    // Deduplicación debe reducir a 2 punches
    assert.equal(r1.sourceLogIds.length, 2, 'Duplicados exactos deben ser deduplicados a 2')
    assert.equal(r1.workedMinutes, 540)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 3: EMPLEADO EQUIVOCADO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-C: Empleado equivocado en el input', () => {

  test('ADV-C1: Punch de empleado B en lista de empleado A debe arrojar InvalidPunchError', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const mixedEmployeePunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_B, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) }, // empleado diferente!
    ]

    assert.throws(
      () => AttendanceEngine.process(TENANT_A, EMP_A, shift, mixedEmployeePunches, { timezone: TZ_CDMX }),
      (err) => err instanceof InvalidPunchError,
      'Debe rechazar punch de empleado B cuando se procesa el empleado A'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 4: TENANT EQUIVOCADO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-D: Tenant equivocado deliberado', () => {

  test('ADV-D1: Introducir deliberadamente un punch de Tenant B entre punches de Tenant A', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const taintedPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_B, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '13:00:00', TZ_CDMX) }, // ← CONTAMINADO
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    assert.throws(
      () => AttendanceEngine.process(TENANT_A, EMP_A, shift, taintedPunches, { timezone: TZ_CDMX }),
      (err) => err instanceof TenantMismatchError,
      'Debe arrojar TenantMismatchError ante contaminación de tenant en el input'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 5: INDEPENDENCIA DE TIMEZONE DEL HOST
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-E: Independencia de TZ del proceso host', () => {

  test('ADV-E1: Resultado con timezone explícito debe ser idéntico independiente de process.env.TZ', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: '2027-01-15T14:00:00.000Z' }, // 08:00 CDMX (UTC-6)
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: '2027-01-15T23:00:00.000Z' }, // 17:00 CDMX (UTC-6)
    ]

    const origTz = process.env.TZ

    // Simular distintas zonas horarias del host
    const results = []
    for (const hostTz of ['UTC', 'America/New_York', 'America/Los_Angeles']) {
      process.env.TZ = hostTz
      results.push(AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX }))
    }
    process.env.TZ = origTz || 'America/Mexico_City'

    const hashes = results.map(r => r.integrityHash)
    assert.equal(hashes[0], hashes[1], 'Hash igual entre host UTC y New York')
    assert.equal(hashes[1], hashes[2], 'Hash igual entre host New York y Los Angeles')
    assert.equal(results[0].workedMinutes, 540, 'workedMinutes invariante a TZ del host')
    assert.equal(results[0].lateMinutes, 0, 'lateMinutes invariante a TZ del host')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 6: CAMBIO DE AÑO (31-dic → 1-ene)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-F: Cambio de año en turno nocturno', () => {

  test('ADV-F1: Turno 31-dic 22:00 → 1-ene 06:00 — operativeDate debe ser 31 de diciembre', () => {
    const operativeDate = '2027-12-31'
    const nextDate = '2028-01-01'
    const shift = { operativeDate, startTime: '22:00', endTime: '06:00', toleranceMinutes: 15 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '22:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(nextDate, '06:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.operativeDate, '2027-12-31', 'Operative date debe permanecer en el año anterior')
    assert.equal(result.workedMinutes, 480, '22:00 a 06:00 = 8 horas = 480 minutos')
    assert.equal(result.lateMinutes, 0)
    assert.equal(result.status, 'PRESENT')
    // ShiftMatcher debe resolver la fecha fin correctamente
    assert.ok(result.scheduledEnd, 'Debe existir scheduledEnd')
    assert.ok(result.scheduledEnd.startsWith('2028-01-01'), 'scheduledEnd debe estar en el nuevo año')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 7: CAMBIO DE MES (31-ene → 1-feb)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-G: Cambio de mes en turno nocturno', () => {

  test('ADV-G1: Turno 31-ene 22:00 → 1-feb 06:00 — operativeDate debe ser 31 enero', () => {
    const operativeDate = '2027-01-31'
    const nextDate = '2027-02-01'
    const shift = { operativeDate, startTime: '22:00', endTime: '06:00', toleranceMinutes: 15 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '22:05:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(nextDate, '06:00:00', TZ_CDMX) }, // salida exactamente a tiempo
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.operativeDate, '2027-01-31', 'Debe permanecer en enero')
    // 22:05 a 06:00 = 7h55m = 475 minutos
    assert.equal(result.workedMinutes, 475, '22:05 a 06:00 = 7h 55m = 475 minutos')
    // 5 minutos de entrada tardía están DENTRO de la tolerancia de 15min → PRESENT, sin penalidad
    assert.equal(result.lateMinutes, 0, 'Entrada a 22:05 con tolerancia 15min → sin penalidad de retardo')
    assert.equal(result.status, 'PRESENT', '5 min dentro de tolerancia de 15min → PRESENT')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 8: AÑO BISIESTO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-H: Año bisiesto', () => {

  test('ADV-H1: Turno nocturno 28-feb-2028 22:00 → 29-feb 06:00 (2028 es bisiesto)', () => {
    const operativeDate = '2028-02-28'
    const shift = { operativeDate, startTime: '22:00', endTime: '06:00', toleranceMinutes: 15 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '22:00:00', TZ_CANCUN) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso('2028-02-29', '06:00:00', TZ_CANCUN) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CANCUN })

    assert.equal(result.operativeDate, '2028-02-28', 'Operative date permanece en 28-feb')
    assert.ok(result.scheduledEnd.includes('2028-02-29'), 'scheduledEnd debe ser 29-feb (día bisiesto)')
    assert.equal(result.workedMinutes, 480)
    assert.equal(result.status, 'PRESENT')
  })

  test('ADV-H2: Jornada diurna en 29-feb-2028 se calcula correctamente', () => {
    const operativeDate = '2028-02-29'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CANCUN) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CANCUN) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CANCUN })

    assert.equal(result.operativeDate, '2028-02-29')
    assert.equal(result.workedMinutes, 540)
    assert.equal(result.status, 'PRESENT')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 9: DST — BOUNDARY EXACTO
// Nota: workedMinutes = MINUTOS REALES TRANSCURRIDOS (epochMs), no minutos de reloj local.
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-I: DST — Semántica explícita de workedMinutes', () => {

  test('ADV-I1: Documenta que workedMinutes = minutos reales (epoch), no minutos de reloj local', () => {
    // En America/New_York, el 2027-03-14 a las 02:00 los relojes saltan a las 03:00 (DST spring-forward)
    // Un turno de 01:00 a 03:00 local solo dura 60 minutos reales (no 120).
    // Este test documenta el comportamiento y lo verifica.
    //
    // NOTA: No inventamos semántica. workedMinutes = epochMs(fin) - epochMs(inicio) / 60000.
    // Está alineado con la intención legal: tiempo real de permanencia del trabajador.

    // En EST (UTC-5), las 01:00 = 06:00 UTC
    // En EDT (UTC-4), las 03:00 = 07:00 UTC (después del salto)
    const entradaUtc = '2027-03-14T06:00:00.000Z' // 01:00 Eastern
    const salidaUtc = '2027-03-14T07:00:00.000Z'  // 03:00 Eastern (post-DST, 60min reales transcurridos)

    const operativeDate = '2027-03-14'
    const shift = {
      operativeDate,
      startTime: '01:00',
      endTime: '03:00', // local; estos son pre y post-DST
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: entradaUtc },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: salidaUtc },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: 'America/New_York' })

    // 60 minutos reales (el reloj saltó: no se trabajaron 120 minutos)
    assert.equal(result.workedMinutes, 60, 'workedMinutes debe reflejar tiempo real transcurrido, no tiempo de reloj local')
    assert.ok(result.integrityHash.length > 0, 'Hash debe existir')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 10: BOUNDARY EXACTO DE TOLERANCIA
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-J: Boundary exacto de tolerancia', () => {
  const operativeDate = '2027-01-15'
  const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }
  const mkPunches = (entryTime) => [
    { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, entryTime, TZ_CDMX) },
    { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
  ]

  test('ADV-J1: 08:09:59 → PRESENT (dentro de tolerancia estricta de 10min)', () => {
    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, mkPunches('08:09:59'), { timezone: TZ_CDMX })
    assert.equal(result.lateMinutes, 0, '08:09:59 está dentro de los 10 minutos de tolerancia')
    assert.equal(result.status, 'PRESENT')
  })

  test('ADV-J2: 08:10:00 → PRESENT (en el límite exacto de tolerancia)', () => {
    // El código usa: if (punchMs > startMs + toleranceMs) → lateMinutes > 0
    // Esto significa que en el exacto límite (igual) NO hay retardo.
    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, mkPunches('08:10:00'), { timezone: TZ_CDMX })
    assert.equal(result.lateMinutes, 0, '08:10:00 exacto (igual al límite) NO debe penalizar retardo — verificar boundary')
    assert.equal(result.status, 'PRESENT')
  })

  test('ADV-J3: 08:10:01 → LATE (superado el límite en 1 segundo)', () => {
    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, mkPunches('08:10:01'), { timezone: TZ_CDMX })
    // lateMinutes = round((08:10:01 - 08:00:00) / 60000) = round(601000/60000) = round(10.016) = 10
    assert.ok(result.lateMinutes > 0, '08:10:01 debe generar retardo pues supera el umbral')
    assert.equal(result.status, 'LATE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 11: DEDUP — VENTANA FIJA (ATT-003 Hardening)
// Semántica CAMBIADA: ahora es ventana fija vs punch RETENIDO, no sliding-window.
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-K: Deduplicación — ventana FIJA (ATT-003 hardening)', () => {

  test('ADV-K1: Ventana fija 5s: [t+0,t+4,t+5,t+6,salida] → t+0 retenido, t+4 y t+5 duplicados, t+6 nuevo burst', () => {
    // SEMÁNTICA DE VENTANA FIJA (ATT-003):
    // t+0 → RETENIDO (inicio burst 1)
    // t+4 → DUPLICADO (4s desde retenido t+0 ≤ 5s)
    // t+5 → DUPLICADO (5s desde retenido t+0 ≤ 5s)
    // t+6 → NUEVO RETENIDO (6s > 5s desde retenido t+0 → inicio burst 2)
    // salida → NUEVO RETENIDO (mucho después de t+6)
    // Total sourceLogIds: t+0, t+6, salida = 3

    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 15 }

    const baseTs = new Date(localToUtcIso(operativeDate, '08:00:00', TZ_CDMX)).getTime()

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 0).toISOString() },     // t+0 → RETENIDO
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 4000).toISOString() },  // t+4s → DUP (4≤5 desde t+0)
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 5000).toISOString() },  // t+5s → DUP (5≤5 desde t+0)
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: new Date(baseTs + 6000).toISOString() },  // t+6s → NUEVO BURST (6>5 desde t+0)
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, {
      timezone: TZ_CDMX,
      deduplication: { minSecondsBetweenPunches: 5, mode: 'KEEP_FIRST' },
    })

    // Ventana FIJA: t+0, t+6, salida = 3 sourceLogIds
    assert.equal(result.sourceLogIds.length, 3,
      'Ventana fija: t+0 retenido, t+4 y t+5 dups, t+6 nuevo burst → 3 sourceLogIds')
    // Verificar trazabilidad (ATT-004)
    const dups = result.punchDispositions.filter(d => d.disposition === 'DUPLICATE')
    assert.equal(dups.length, 2, 't+4 y t+5 deben aparecer como DUPLICATE en punchDispositions')
  })

  test('ADV-K2: Ventana fija vs sliding: 20 punches×4s con window=5s → 10 bursts (no 1 colapsado)', () => {
    // DIFERENCIA CLAVE (ATT-003 hardening):
    // Sliding-window ANTERIOR: todos se agrupaban en 1 porque comparaba vs el previo.
    // Ventana FIJA NUEVA: t+0 retiene; t+4 (4≤5) dup; t+8 (8>5 desde t+0) → nuevo retained;
    // t+12 (4≤5 desde t+8) dup; t+16 nuevo retained; etc.
    // 20 punches × 4s → 10 bursts (t=0,8,16,24,32,40,48,56,64,72) + salida = 11 sourceLogIds

    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 30 }
    const baseTs = new Date(localToUtcIso(operativeDate, '08:00:00', TZ_CDMX)).getTime()

    const manyRapidPunches = []
    for (let i = 0; i < 20; i++) {
      manyRapidPunches.push({
        clienteId: TENANT_A,
        empleadoId: EMP_A,
        timestamp: new Date(baseTs + i * 4000).toISOString(),
      })
    }
    manyRapidPunches.push({
      clienteId: TENANT_A,
      empleadoId: EMP_A,
      timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX),
    })

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, manyRapidPunches, {
      timezone: TZ_CDMX,
      deduplication: { minSecondsBetweenPunches: 5 },
    })

    // Fixed-window: 10 bursts retenidos + 1 salida = 11 sourceLogIds
    assert.equal(result.sourceLogIds.length, 11,
      'Ventana fija: 20 punches×4s = 10 bursts separados (no 1 colapsado) + salida = 11')
    const dups = result.punchDispositions.filter(d => d.disposition === 'DUPLICATE')
    assert.equal(dups.length, 10, 'Deben haber 10 DUPLICATE trazables')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 12: TURNO MUY LARGO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-L: Turno muy largo (24h)', () => {

  test('ADV-L1: Turno 08:00 → 08:00 siguiente día — comportamiento explícito', () => {
    // Un turno de 24h: startTime == endTime → endMinutes <= startMinutes → crossesMidnight = true
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '08:00', toleranceMinutes: 30 }

    // Comprobar que ShiftMatcher no lanza error y maneja esto
    // scheduledMinutes debería ser 0 o 1440 (24h)
    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso('2027-01-16', '08:00:00', TZ_CDMX) },
    ]

    // No debe lanzar error — debe tener comportamiento explícito
    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })
    assert.ok(typeof result.scheduledMinutes === 'number', 'scheduledMinutes debe ser número')
    // 08:00 → 08:00 siguiente día = 1440 minutos (24h)
    assert.equal(result.scheduledMinutes, 1440, 'Turno 08:00→08:00 debe ser interpretado como 24h completas')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 13: 3 CHECADAS (IMPAR)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-M: Cantidad impar de marcajes', () => {

  test('ADV-M1: 3 marcajes [08:00, 13:00, 18:00] → missingExit=true, 1 segmento de trabajo, 0 descanso', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '13:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '18:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // El motor interpreta la cantidad impar como missingExit (el último punch queda sin par)
    assert.equal(result.missingExit, true, '3 marcajes = número impar → missingExit debe ser true')
    assert.equal(result.status, 'INCOMPLETE', 'INCOMPLETE por missingExit')

    // El loop de i += 2 produce 1 segmento de trabajo (par 0-1), el punch[2] queda sin par
    assert.equal(result.segments.filter(s => s.segmentType === 'WORK').length, 1, 'Un solo segmento de trabajo')

    // NOTA AUDITOR: Este comportamiento puede ser confuso.
    // [08:00 ENTRY, 13:00 ?, 18:00 ?] — el motor trata los punches en pares secuenciales
    // sin considerar el inOutType para decidir el pareado.
    // Este es un hallazgo HIGH a documentar.
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 14: 5 CHECADAS (IMPAR)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-N: 5 marcajes', () => {

  test('ADV-N1: 5 marcajes [08, 13, 14, 16, 17:30] → 2 segmentos, missingExit=true', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:30' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '13:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '14:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '16:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:30:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.missingExit, true, '5 = impar → missingExit=true')
    assert.equal(result.segments.filter(s => s.segmentType === 'WORK').length, 2, '2 segmentos de trabajo')
    assert.equal(result.status, 'INCOMPLETE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 15: 1000 CHECADAS (RENDIMIENTO) — ventana fija ATT-003
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-O: Rendimiento con 1000 marcajes anómalos', () => {

  test('ADV-O1: 1000 marcajes no deben producir stack overflow; ventana fija produce 2-3 bursts', () => {
    // 999 punches × 100ms = 99.9 segundos total.
    // Con window=60s (default):
    //   t=0 → RETENIDO
    //   t=100ms...t=59.9s → DUPLICATE (todos ≤ 60s desde t=0)
    //   t=60s (punch 600) → NUEVO RETENIDO (60000ms > 60000ms NO → en el límite exacto → DUPLICATE)
    //   t=60.1s (punch 601) → NUEVO RETENIDO (60100ms > 60000ms)
    //   t=60.1s...t=99.9s → DUPLICATE (todos ≤ 60s desde t=60.1s)
    // Total aceptados: t=0, t≈60.1s = 2 bursts + salida = 3 sourceLogIds
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 30 }

    const baseMs = new Date(localToUtcIso(operativeDate, '08:00:00', TZ_CDMX)).getTime()
    const rawPunches = []

    for (let i = 0; i < 999; i++) {
      rawPunches.push({
        clienteId: TENANT_A,
        empleadoId: EMP_A,
        timestamp: new Date(baseMs + i * 100).toISOString(), // cada 100ms
      })
    }
    rawPunches.push({
      clienteId: TENANT_A,
      empleadoId: EMP_A,
      timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX),
    })

    const start = Date.now()
    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })
    const elapsed = Date.now() - start

    assert.ok(elapsed < 2000, `1000 marcajes deben procesarse en menos de 2s (tardó ${elapsed}ms)`)

    // Con ventana fija 60s: 2 bursts + salida = 3 sourceLogIds
    // (t=0 y t≈60.1s son los únicos retenidos de los 999 punches rápidos)
    assert.ok(result.sourceLogIds.length <= 5,
      `Ventana fija 60s debe producir ≤ 5 bursts de 999 punches×100ms (actual: ${result.sourceLogIds.length})`)
    assert.ok(result.sourceLogIds.length >= 2,
      'Debe haber al menos 2 sourceLogIds (burst inicial + salida)')
    assert.equal(result.workedMinutes, 540)

    // Verificar trazabilidad: deben haber ≥ 995 DUPLICATE (ATT-004)
    const dups = result.punchDispositions.filter(d => d.disposition === 'DUPLICATE')
    assert.ok(dups.length >= 995, `Deben haber ≥ 995 DUPLICATE trazables (actual: ${dups.length})`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 16: FESTIVO + DÍA DE DESCANSO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-S: Festivo + Descanso simultáneo', () => {

  test('ADV-S1: Día marcado como HOLIDAY y REST_DAY al mismo tiempo — HOLIDAY toma precedencia', () => {
    const operativeDate = '2027-01-17' // Hipotético: festivo que cae en descanso
    const shift = {
      operativeDate,
      isHoliday: true,
      isRestDay: true,
      holidayName: 'Festivo en Descanso',
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '10:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '14:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // IncidentDetector evalúa isHoliday ANTES que isRestDay → HOLIDAY toma precedencia
    assert.equal(result.status, 'HOLIDAY_WORK', 'HOLIDAY debe tener precedencia sobre REST_DAY')
    // No debe duplicar el tiempo extra
    assert.equal(result.overtimeMinutes, result.effectiveMinutes, 'Todo el tiempo es overtime en festivo')
    // No debe aparecer REST_DAY_WORK además de HOLIDAY_WORK en la misma jornada
    const hasRestDayIncident = result.incidents.some(i => i.code === 'REST_DAY_WORK')
    assert.equal(hasRestDayIncident, false, 'No debe haber incidencia REST_DAY_WORK cuando ya hay HOLIDAY_WORK')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 17: RETARDO + SALIDA ANTICIPADA SIMULTÁNEOS
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-T: Retardo y salida anticipada en la misma jornada', () => {

  test('ADV-T1: 08:15 entrada + 16:30 salida con tolerancia 10min → INCOMPLETE status (tarde y temprano)', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:15:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '16:30:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.lateMinutes, 15, 'Debe detectar 15 min de retardo')
    assert.equal(result.earlyLeaveMinutes, 30, 'Debe detectar 30 min de salida anticipada')

    // Confirma que ambas incidencias existen simultáneamente
    const hasLate = result.incidents.some(i => i.code === 'LATE')
    const hasEarlyLeave = result.incidents.some(i => i.code === 'EARLY_LEAVE')
    assert.ok(hasLate, 'Debe existir incidencia LATE')
    assert.ok(hasEarlyLeave, 'Debe existir incidencia EARLY_LEAVE')

    // NOTA AUDITOR (FINDING MEDIUM): El status sólo reporta UNO de los estados.
    // IncidentDetector: si missingEntry || missingExit → INCOMPLETE
    // else if late → LATE; else if earlyLeave → EARLY_LEAVE; else PRESENT
    // Con LATE y EARLY_LEAVE simultáneos, el status será LATE (no EARLY_LEAVE).
    // Esto es un hallazgo: status no captura co-ocurrencia de LATE + EARLY_LEAVE.
    assert.equal(result.status, 'LATE', 'Status actual es LATE cuando hay ambas — documentar como limitación')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 18: TURNO NOCTURNO + RETARDO
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-U: Turno nocturno con retardo', () => {

  test('ADV-U1: Turno 22:00→06:00, entrada 22:20 → retardo de 20 minutos', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '22:00', endTime: '06:00', toleranceMinutes: 10 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '22:20:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso('2027-01-16', '06:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.lateMinutes, 20, 'Retardo de 20 minutos en turno nocturno')
    assert.equal(result.status, 'LATE')
    assert.equal(result.operativeDate, '2027-01-15', 'Operative date debe ser día de inicio del turno nocturno')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 19: HASH CANÓNICO — ORDEN DE PROPIEDADES
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-V: Hash canónico — invariante al orden', () => {

  test('ADV-V1: sourceLogIds en diferente orden produce el mismo hash', () => {
    const payload = {
      clienteId: TENANT_A,
      empleadoId: EMP_A,
      operativeDate: '2027-01-15',
      timezone: TZ_CDMX,
      scheduleId: 'shift-001',
      scheduledStart: '2027-01-15T14:00:00.000Z',
      scheduledEnd: '2027-01-15T23:00:00.000Z',
      actualStart: '2027-01-15T14:00:00.000Z',
      actualEnd: '2027-01-15T23:00:00.000Z',
      workedMinutes: 540,
      breakMinutes: 0,
      effectiveMinutes: 540,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      ordinaryMinutes: 480,
      overtimeMinutes: 60,
      status: 'PRESENT',
      sourceLogIds: ['log-001', 'log-002', 'log-003'],
      incidentCodes: ['OVERTIME_DETECTED'],
      calculationVersion: 1,
    }

    const reversed = {
      ...payload,
      sourceLogIds: ['log-003', 'log-002', 'log-001'],  // orden diferente
      incidentCodes: ['OVERTIME_DETECTED'],
    }

    const hash1 = WorkdayIntegrityHasher.computeHash(payload)
    const hash2 = WorkdayIntegrityHasher.computeHash(reversed)

    assert.equal(hash1, hash2, 'sourceLogIds en distinto orden deben producir el mismo hash (se ordenan internamente)')
  })

  test('ADV-V2: Hash cambia si se modifica un solo campo', () => {
    const payload = {
      clienteId: TENANT_A,
      empleadoId: EMP_A,
      operativeDate: '2027-01-15',
      timezone: TZ_CDMX,
      workedMinutes: 540,
      breakMinutes: 0,
      effectiveMinutes: 540,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      ordinaryMinutes: 540,
      overtimeMinutes: 0,
      status: 'PRESENT',
      sourceLogIds: ['log-001', 'log-002'],
      incidentCodes: [],
      calculationVersion: 1,
    }

    const modified = { ...payload, lateMinutes: 1 } // cambiar un solo campo

    const hash1 = WorkdayIntegrityHasher.computeHash(payload)
    const hash2 = WorkdayIntegrityHasher.computeHash(modified)

    assert.notEqual(hash1, hash2, 'Cambiar un campo debe cambiar el hash')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 20: INVARIANTES MATEMÁTICOS
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-W: Invariantes matemáticos del WorkdayCalculator', () => {
  const operativeDate = '2027-01-15'
  const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

  const scenarios = [
    // [descripción, entrada, salida]
    ['puntual', '08:00:00', '17:00:00'],
    ['retardo', '08:30:00', '17:00:00'],
    ['salida anticipada', '08:00:00', '16:00:00'],
    ['retardo y salida anticipada', '08:20:00', '16:30:00'],
    ['tiempo extra', '08:00:00', '19:00:00'],
  ]

  for (const [desc, entryTime, exitTime] of scenarios) {
    test(`ADV-W1: Invariantes matemáticos — ${desc}`, () => {
      const rawPunches = [
        { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, entryTime, TZ_CDMX) },
        { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, exitTime, TZ_CDMX) },
      ]

      const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

      // Invariante 1: Todos los valores de tiempo son >= 0
      assert.ok(result.workedMinutes >= 0, `workedMinutes >= 0 (${desc})`)
      assert.ok(result.breakMinutes >= 0, `breakMinutes >= 0 (${desc})`)
      assert.ok(result.effectiveMinutes >= 0, `effectiveMinutes >= 0 (${desc})`)
      assert.ok(result.lateMinutes >= 0, `lateMinutes >= 0 (${desc})`)
      assert.ok(result.earlyLeaveMinutes >= 0, `earlyLeaveMinutes >= 0 (${desc})`)
      assert.ok(result.ordinaryMinutes >= 0, `ordinaryMinutes >= 0 (${desc})`)
      assert.ok(result.overtimeMinutes >= 0, `overtimeMinutes >= 0 (${desc})`)
      assert.ok(result.nightShiftMinutes >= 0, `nightShiftMinutes >= 0 (${desc})`)

      // Invariante 2: ordinaryMinutes + overtimeMinutes debe ser <= effectiveMinutes
      // (puede ser igual si no hay descanso)
      assert.ok(
        result.ordinaryMinutes + result.overtimeMinutes <= result.effectiveMinutes + 1, // +1 por tolerancia de Math.round
        `ordinaryMinutes + overtimeMinutes <= effectiveMinutes (${desc}): ${result.ordinaryMinutes} + ${result.overtimeMinutes} <= ${result.effectiveMinutes}`
      )

      // Invariante 3: Segmentos — cada segmento tiene durationMinutes >= 0
      for (const seg of result.segments) {
        assert.ok(seg.durationMinutes >= 0, `Segmento ${seg.segmentType} tiene durationMinutes >= 0 (${desc})`)
      }
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 21: SOURCE LOG IDS — TRAZABILIDAD
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-X: Trazabilidad de sourceLogIds', () => {

  test('ADV-X1: Todos los IDs aceptados deben aparecer en sourceLogIds (dentro de ventana)', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', windowBeforeStartMinutes: 60 }

    const rawPunches = [
      { id: 'log-IN', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { id: 'log-OUT', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.ok(result.sourceLogIds.includes('log-IN'), 'log-IN debe estar en sourceLogIds')
    assert.ok(result.sourceLogIds.includes('log-OUT'), 'log-OUT debe estar en sourceLogIds')
    assert.equal(result.sourceLogIds.length, 2)
  })

  test('ADV-X2: Punch fuera de ventana NO debe aparecer en sourceLogIds pero SÍ debe ser trazable', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      windowBeforeStartMinutes: 60, // Ventana abre a las 07:00
    }

    const rawPunches = [
      { id: 'log-EARLY', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '04:00:00', TZ_CDMX) }, // FUERA
      { id: 'log-IN', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { id: 'log-OUT', clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    // sourceLogIds sólo tiene los aceptados (dentro de ventana)
    assert.ok(!result.sourceLogIds.includes('log-EARLY'), 'log-EARLY no debe estar en sourceLogIds')
    assert.ok(result.sourceLogIds.includes('log-IN'), 'log-IN debe estar en sourceLogIds')

    // El punch fuera de ventana DEBE ser trazable vía incidencias
    const outOfWindowIncident = result.incidents.find(i => i.code === 'OUT_OF_WINDOW_PUNCH')
    assert.ok(outOfWindowIncident, 'Debe existir incidencia OUT_OF_WINDOW_PUNCH')

    // NOTA AUDITOR (FINDING HIGH): outOfWindowPunches y sus IDs están en las incidencias
    // pero NO hay un campo dedicado 'ignoredPunches' o 'discardedLogIds' en el resultado final.
    // La trazabilidad de descartados solo existe si se busca en incidents.metadata.punchIds
    const punchIds = outOfWindowIncident?.metadata?.punchIds
    assert.ok(Array.isArray(punchIds), 'punchIds deben existir en metadata del incidente')
    assert.ok(punchIds.includes('log-EARLY'), 'log-EARLY debe aparecer en metadata.punchIds del incidente')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 22: RETARDO — lateMinutes INCLUYE TOLERANCIA O NO?
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-LATE: Semántica exacta de lateMinutes', () => {

  test('ADV-LATE1: lateMinutes = minutos desde hora programada (no desde fin de tolerancia)', () => {
    // La pregunta: si entro a las 08:15 con tolerancia de 10 min:
    // ¿lateMinutes = 15 (desde 08:00) o lateMinutes = 5 (desde 08:10)?
    // El código: lateMinutes = round((punchMs - startMs) / 60000)
    // = round((08:15 - 08:00) / 1min) = 15
    // SEMÁNTICA: lateMinutes mide desde la hora programada, no desde el fin de tolerancia.
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:15:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, { timezone: TZ_CDMX })

    assert.equal(result.lateMinutes, 15, 'lateMinutes = minutos desde hora programada (08:00), no desde fin de tolerancia')
    // NOTA AUDITOR (FINDING MEDIUM): Esto puede generar confusión en prenómina.
    // Si tolerancia = 10 min y lateMinutes = 15, ¿se descuentan 15 min o 5 min?
    // La semántica debe documentarse explícitamente para prenómina.
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 23: EFFECTIVE MINUTES — VERIFICACIÓN MATEMÁTICA
// ─────────────────────────────────────────────────────────────────────────────
describe('ADV-EFFECTIVE: Verificación de effectiveMinutes con 2 punches', () => {

  test('ADV-EFFECTIVE1: Con 2 punches y sin deducción de descanso, effectiveMinutes = workedMinutes', () => {
    // El código en WorkdayCalculator: con 2 punches:
    // totalWorkMinutes = round((pOut - pIn) / 60000)
    // effectiveMinutes = max(0, totalWorkMinutes - (punches.length === 2 ? totalBreakMinutes : 0))
    // totalBreakMinutes con 2 punches = 0 (no hay segmento de descanso)
    // → effectiveMinutes = totalWorkMinutes = workedMinutes

    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', scheduledBreakMinutes: 60 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '08:00:00', TZ_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_A, timestamp: localToUtcIso(operativeDate, '17:00:00', TZ_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_A, shift, rawPunches, {
      timezone: TZ_CDMX,
      autoDeductScheduledBreakIfNoPunches: false,
    })

    // Con 2 punches sin autoDeduct: effectiveMinutes = workedMinutes = 540
    assert.equal(result.effectiveMinutes, 540, 'Sin autoDeduct, effectiveMinutes = workedMinutes con 2 punches')
    assert.equal(result.breakMinutes, 0, 'Sin 4 punches, breakMinutes = 0 (sin autoDeduct)')
  })
})
