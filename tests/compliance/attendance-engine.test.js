/**
 * tests/compliance/attendance-engine.test.js
 * Suite completa de pruebas unitarias para el Attendance Engine.
 *
 * Módulo: Cumplimiento Laboral México 2027
 * Casos evaluados: A hasta V (Normal, Retardos, Nocturnos, Deduplicación, Idempotencia, Timezones, RLS/Multi-tenant).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  AttendanceEngine,
  AttendanceNormalizer,
  ShiftMatcher,
  WorkdayCalculator,
  IncidentDetector,
  WorkdayIntegrityHasher,
  localToUtcIso,
  getLocalComponents,
  TenantMismatchError,
  InvalidTimezoneError,
} from '../../src/domain/attendance/index.ts'

describe('Attendance Engine - Suite de Cumplimiento Laboral 2027', () => {
  const TENANT_A = 'tenant_signum_test_company_001'
  const TENANT_B = 'tenant_signum_test_company_002'
  const EMP_001 = 'emp_juan_perez_001'
  const EMP_002 = 'emp_maria_lopez_002'
  const TIMEZONE_CDMX = 'America/Mexico_City'

  // ─────────────────────────────────────────────────────────────
  // CASO A: Entrada y Salida Normales (Puntual)
  // ─────────────────────────────────────────────────────────────
  test('Caso A: Entrada y salida normales -> PRESENT sin retardo ni salida anticipada', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX),
        source: 'ADMS',
        deviceSerial: 'ZK-SN-001',
      },
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX),
        source: 'ADMS',
        deviceSerial: 'ZK-SN-001',
      },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.workedMinutes, 540) // 9 horas (08:00 a 17:00)
    assert.equal(result.effectiveMinutes, 540)
    assert.equal(result.lateMinutes, 0)
    assert.equal(result.earlyLeaveMinutes, 0)
    assert.equal(result.missingEntry, false)
    assert.equal(result.missingExit, false)
    assert.equal(result.sourceLogIds.length, 2)
    assert.ok(result.integrityHash)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO B: Retardo en Entrada
  // ─────────────────────────────────────────────────────────────
  test('Caso B: Retardo en entrada -> LATE y late_minutes = 15', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '08:15:00', TIMEZONE_CDMX), // 15m tarde
      },
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX),
      },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'LATE')
    assert.equal(result.lateMinutes, 15)
    assert.equal(result.earlyLeaveMinutes, 0)
    assert.ok(result.incidents.some((i) => i.code === 'LATE' && i.minutes === 15))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO C: Salida Anticipada
  // ─────────────────────────────────────────────────────────────
  test('Caso C: Salida anticipada -> EARLY_LEAVE y early_leave_minutes = 30', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX),
      },
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '16:30:00', TIMEZONE_CDMX), // 30m antes
      },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'EARLY_LEAVE')
    assert.equal(result.earlyLeaveMinutes, 30)
    assert.equal(result.lateMinutes, 0)
    assert.ok(result.incidents.some((i) => i.code === 'EARLY_LEAVE' && i.minutes === 30))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO D: Entrada sin Salida
  // ─────────────────────────────────────────────────────────────
  test('Caso D: Entrada sin salida -> INCOMPLETE con missingExit = true', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
    }

    const rawPunches = [
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX),
      },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.missingEntry, false)
    assert.equal(result.missingExit, true)
    assert.ok(result.actualStart)
    assert.equal(result.actualEnd, undefined)
    assert.ok(result.incidents.some((i) => i.code === 'MISSING_EXIT'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO E: Sin Entrada (Ausencia Total)
  // ─────────────────────────────────────────────────────────────
  test('Caso E: Sin marcajes en jornada programada -> ABSENT', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
    }

    const rawPunches = []

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'ABSENT')
    assert.equal(result.workedMinutes, 0)
    assert.equal(result.effectiveMinutes, 0)
    assert.ok(result.incidents.some((i) => i.code === 'ABSENT'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO F: Turno Partido (Comida de 1 Hora)
  // ─────────────────────────────────────────────────────────────
  test('Caso F: Turno partido (4 checadas) -> 2 segmentos de trabajo y 1h de descanso', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '18:00',
      hasBreak: true,
      scheduledBreakMinutes: 60,
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '13:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '14:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '18:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.workedMinutes, 600) // 10 horas totales (08:00 a 18:00)
    assert.equal(result.breakMinutes, 60) // 1 hora de comida (13:00 a 14:00)
    assert.equal(result.effectiveMinutes, 540) // 9 horas efectivas
    assert.equal(result.segments.filter((s) => s.segmentType === 'WORK').length, 2)
    assert.equal(result.segments.filter((s) => s.segmentType === 'BREAK').length, 1)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO G: Turno Nocturno (22:00 a 06:00 del Día Siguiente)
  // ─────────────────────────────────────────────────────────────
  test('Caso G: Turno nocturno que cruza medianoche -> Operative date es día de inicio', () => {
    const operativeDate = '2027-01-15'
    const nextDate = '2027-01-16'

    const shift = {
      operativeDate,
      startTime: '22:00',
      endTime: '06:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '21:58:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(nextDate, '06:03:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.operativeDate, '2027-01-15')
    assert.equal(result.shiftType, 'NOCTURNA')
    assert.equal(result.workedMinutes, 485) // 21:58 a 06:03 = 8h 05m
    assert.equal(result.lateMinutes, 0)
    assert.equal(result.earlyLeaveMinutes, 0)
    assert.ok(result.nightShiftMinutes > 400)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO H: Cruce de Medianoche Continuo
  // ─────────────────────────────────────────────────────────────
  test('Caso H: Cruce de medianoche no fragmenta erróneamente la jornada', () => {
    const operativeDate = '2027-01-15'
    const nextDate = '2027-01-16'

    const shift = {
      operativeDate,
      startTime: '20:00',
      endTime: '04:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '20:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(nextDate, '00:30:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(nextDate, '01:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(nextDate, '04:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.operativeDate, '2027-01-15')
    assert.equal(result.breakMinutes, 30)
    assert.equal(result.effectiveMinutes, 450) // 8h - 30m = 7h 30m
  })

  // ─────────────────────────────────────────────────────────────
  // CASO I: Checada Duplicada Idéntica
  // ─────────────────────────────────────────────────────────────
  test('Caso I: Checada duplicada exacta -> Deduplicada sin corromper tiempos', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) }, // Duplicado
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.sourceLogIds.length, 2)
    assert.equal(result.workedMinutes, 540)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO J: Checadas Muy Cercanas (Debounce Rápido en Biométrico)
  // ─────────────────────────────────────────────────────────────
  test('Caso J: Ráfaga de checadas en 4 segundos -> Agrupadas como 1 solo marcaje', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:01', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:05', TIMEZONE_CDMX) }, // 4 seg después
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
      deduplication: { minSecondsBetweenPunches: 10 },
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.sourceLogIds.length, 2)
    assert.equal(result.missingExit, false)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO K: Múltiples Pares (6 checadas)
  // ─────────────────────────────────────────────────────────────
  test('Caso K: 6 checadas -> 3 segmentos de trabajo y 2 descansos', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '18:00' }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '10:00:00', TIMEZONE_CDMX) }, // 120m
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '10:15:00', TIMEZONE_CDMX) }, // 15m break
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '13:00:00', TIMEZONE_CDMX) }, // 165m
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '14:00:00', TIMEZONE_CDMX) }, // 60m break
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '18:00:00', TIMEZONE_CDMX) }, // 240m
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.breakMinutes, 75) // 15m + 60m
    assert.equal(result.effectiveMinutes, 525) // 120 + 165 + 240 = 525m
  })

  // ─────────────────────────────────────────────────────────────
  // CASO L: Checada Fuera de Ventana (03:00 AM para turno de 08:00)
  // ─────────────────────────────────────────────────────────────
  test('Caso L: Checada a las 03:00 AM fuera de ventana -> Incident OUT_OF_WINDOW_PUNCH', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      windowBeforeStartMinutes: 120, // Ventana abre a las 06:00
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '03:00:00', TIMEZONE_CDMX) }, // Fuera
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.ok(result.incidents.some((i) => i.code === 'OUT_OF_WINDOW_PUNCH'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO M: Turnos Consecutivos en Días Sucesivos
  // ─────────────────────────────────────────────────────────────
  test('Caso M: Dos turnos consecutivos -> Marcajes se asignan a su respectiva fecha', () => {
    const day1 = '2027-01-15'
    const day2 = '2027-01-16'

    const shift1 = { operativeDate: day1, startTime: '08:00', endTime: '17:00' }
    const shift2 = { operativeDate: day2, startTime: '08:00', endTime: '17:00' }

    const allPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(day1, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(day1, '17:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(day2, '07:55:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(day2, '17:05:00', TIMEZONE_CDMX) },
    ]

    const resultDay1 = AttendanceEngine.process(TENANT_A, EMP_001, shift1, allPunches, { timezone: TIMEZONE_CDMX })
    const resultDay2 = AttendanceEngine.process(TENANT_A, EMP_001, shift2, allPunches, { timezone: TIMEZONE_CDMX })

    assert.equal(resultDay1.status, 'PRESENT')
    assert.equal(resultDay1.operativeDate, day1)
    assert.equal(resultDay1.sourceLogIds.length, 2)

    assert.equal(resultDay2.status, 'PRESENT')
    assert.equal(resultDay2.operativeDate, day2)
    assert.equal(resultDay2.sourceLogIds.length, 2)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO N: Independencia de Timezone / DST (Cancún vs CDMX vs Tijuana)
  // ─────────────────────────────────────────────────────────────
  test('Caso N: Timezone explícito en Cancún (UTC-5 sin DST) vs CDMX (UTC-6)', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    // 08:00 en Cancún = 13:00 UTC
    const punchCancunIn = '2027-01-15T13:00:00.000Z'
    const punchCancunOut = '2027-01-15T22:00:00.000Z'

    const resultCancun = AttendanceEngine.process(
      TENANT_A,
      EMP_001,
      shift,
      [
        { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: punchCancunIn },
        { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: punchCancunOut },
      ],
      { timezone: 'America/Cancun' }
    )

    assert.equal(resultCancun.status, 'PRESENT')
    assert.equal(resultCancun.timezone, 'America/Cancun')
    assert.equal(resultCancun.lateMinutes, 0)
    assert.equal(resultCancun.workedMinutes, 540)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO O: Aislamiento Estricto Multi-Tenant (Mismo employee code)
  // ─────────────────────────────────────────────────────────────
  test('Caso O: Dos tenants con mismo código de empleado -> No se mezclan y arroja error si se cruzan', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    const mixedPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_B, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX) }, // Tenant B!
    ]

    assert.throws(
      () => {
        AttendanceEngine.process(TENANT_A, EMP_001, shift, mixedPunches, { timezone: TIMEZONE_CDMX })
      },
      (err) => err instanceof TenantMismatchError
    )
  })

  // ─────────────────────────────────────────────────────────────
  // CASO P: Idempotencia Absoluta (10 ejecuciones idénticas)
  // ─────────────────────────────────────────────────────────────
  test('Caso P: Idempotencia -> Ejecutar 10 veces genera exactamente el mismo hash y métricas', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00', toleranceMinutes: 10 }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:02:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '13:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '14:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '18:12:00', TIMEZONE_CDMX) },
    ]

    const runs = []
    for (let i = 0; i < 10; i++) {
      runs.push(
        AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
          timezone: TIMEZONE_CDMX,
          calculationVersion: 1,
        })
      )
    }

    const firstRun = runs[0]
    for (let i = 1; i < 10; i++) {
      assert.equal(runs[i].integrityHash, firstRun.integrityHash)
      assert.equal(runs[i].workedMinutes, firstRun.workedMinutes)
      assert.equal(runs[i].effectiveMinutes, firstRun.effectiveMinutes)
      assert.equal(runs[i].lateMinutes, firstRun.lateMinutes)
      assert.equal(runs[i].status, firstRun.status)
    }
  })

  // ─────────────────────────────────────────────────────────────
  // CASO Q: Reglas Legales Desacopladas (Mock Provider)
  // ─────────────────────────────────────────────────────────────
  test('Caso Q: Proveedor de reglas inyectado -> Controla límite ordinario sin hardcode', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' } // 9h en centro (540m)

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '18:00:00', TIMEZONE_CDMX) }, // 600m
    ]

    // Mock rule provider: Límite diario de 7 horas (420m)
    const customRuleProvider = {
      getRulesForDate: () => ({
        maxDailyOrdinaryMinutes: 420,
        maxWeeklyOrdinaryMinutes: 2400,
        overtimeDoubleMaxWeeklyMinutes: 540,
      }),
    }

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
      laborRuleProvider: customRuleProvider,
    })

    assert.equal(result.effectiveMinutes, 600)
    assert.equal(result.ordinaryMinutes, 420) // Limitado a 7h
    assert.equal(result.overtimeMinutes, 180) // 3h extras detectadas
    assert.ok(result.incidents.some((i) => i.code === 'OVERTIME_DETECTED' && i.minutes === 180))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO R: Día Festivo Laborado
  // ─────────────────────────────────────────────────────────────
  test('Caso R: Día festivo laborado -> HOLIDAY_WORK y todo el tiempo es overtime/adicional', () => {
    const operativeDate = '2027-01-01'
    const shift = {
      operativeDate,
      isHoliday: true,
      holidayName: 'Año Nuevo',
      startTime: '09:00',
      endTime: '15:00',
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '09:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '15:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'HOLIDAY_WORK')
    assert.equal(result.isHoliday, true)
    assert.equal(result.effectiveMinutes, 360)
    assert.equal(result.overtimeMinutes, 360)
    assert.ok(result.incidents.some((i) => i.code === 'HOLIDAY_WORK'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO S: Día de Descanso Laborado
  // ─────────────────────────────────────────────────────────────
  test('Caso S: Día de descanso laborado -> REST_DAY_WORK', () => {
    const operativeDate = '2027-01-17' // Domingo
    const shift = {
      operativeDate,
      isRestDay: true,
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '10:00:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '14:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'REST_DAY_WORK')
    assert.equal(result.isRestDay, true)
    assert.equal(result.effectiveMinutes, 240)
    assert.ok(result.incidents.some((i) => i.code === 'REST_DAY_WORK'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO T: Tolerancia en Entrada (Check-in dentro de tolerancia)
  // ─────────────────────────────────────────────────────────────
  test('Caso T: Llegada 08:08 con tolerancia de 10 min -> PRESENT sin penalización de retardo', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
      toleranceMinutes: 10,
    }

    const rawPunches = [
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '08:08:00', TIMEZONE_CDMX) },
      { clienteId: TENANT_A, empleadoId: EMP_001, timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX) },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'PRESENT')
    assert.equal(result.lateMinutes, 0)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO U: Salida sin Entrada
  // ─────────────────────────────────────────────────────────────
  test('Caso U: Salida registrada pero sin entrada -> INCOMPLETE y missingEntry = true', () => {
    const operativeDate = '2027-01-15'
    const shift = {
      operativeDate,
      startTime: '08:00',
      endTime: '17:00',
    }

    const rawPunches = [
      {
        clienteId: TENANT_A,
        empleadoId: EMP_001,
        timestamp: localToUtcIso(operativeDate, '17:00:00', TIMEZONE_CDMX),
        inOutState: 1, // Salida explícita
      },
    ]

    const result = AttendanceEngine.process(TENANT_A, EMP_001, shift, rawPunches, {
      timezone: TIMEZONE_CDMX,
    })

    assert.equal(result.status, 'INCOMPLETE')
    assert.equal(result.missingEntry, true)
    assert.equal(result.missingExit, false)
    assert.equal(result.actualStart, undefined)
    assert.ok(result.actualEnd)
    assert.ok(result.incidents.some((i) => i.code === 'MISSING_ENTRY'))
  })

  // ─────────────────────────────────────────────────────────────
  // CASO V: Zona Horaria Inválida Arroja Error Tipado
  // ─────────────────────────────────────────────────────────────
  test('Caso V: Zona horaria inválida arroja InvalidTimezoneError', () => {
    const operativeDate = '2027-01-15'
    const shift = { operativeDate, startTime: '08:00', endTime: '17:00' }

    assert.throws(
      () => {
        AttendanceEngine.process(TENANT_A, EMP_001, shift, [], { timezone: 'Fake/Invalid_Zone' })
      },
      (err) => err instanceof InvalidTimezoneError
    )
  })
})
