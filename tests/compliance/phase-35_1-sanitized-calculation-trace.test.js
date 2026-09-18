/** Phase 35.1 validates diagnostic evidence without changing calculation semantics. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { computeScheduleRevisionIntegrityHash } from '../../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const require = createRequire(import.meta.url)
const runner = require('../../backend/scripts/run-production-workday-shadow-canary.js')
const {
  APPROVED_REGISTRO_ID: REGISTRO, APPROVED_TENANT_ID: TENANT,
  APPROVED_EMPLOYEE_ID: EMPLOYEE, APPROVED_DEVICE_ID: DEVICE,
  APPROVED_SCHEDULE_ID: SCHEDULE, runProductionEngineShadowTrace,
} = runner

function environment() {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-secret',
    SHADOW_CANARY_ALLOWED_HOST: 'project.example.supabase.co',
    SHADOW_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW',
    SHADOW_CANARY_CONFIRMATION: 'I_APPROVE_READ_ONLY_SHADOW',
  }
}

function records() {
  const anchor = {
    id: REGISTRO, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
    verificado_at: '2026-09-03T16:26:04.000Z', tipo_verificacion: 'entrada', metodo: 'face',
    source_event_id: 'source-anchor', es_manual: false, raw_payload: { forbidden: true },
  }
  return [anchor, ...Array.from({ length: 15 }, (_, index) => ({
    id: `trace-${String(index + 1).padStart(2, '0')}`,
    cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
    verificado_at: `2026-09-03T${String(11 + Math.floor(((index + 1) * 4) / 60)).padStart(2, '0')}:${String(((index + 1) * 4) % 60).padStart(2, '0')}:00.000Z`,
    tipo_verificacion: index < 6 ? 'entrada' : 'salida', metodo: 'face',
    source_event_id: `source-${index + 1}`, es_manual: false, raw_payload: { forbidden: true },
  }))]
}

function fakeClient(data = {}) {
  const revisionSnapshot = {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: false }, mar: { activo: false }, mie: { activo: false },
      jue: { activo: true, entrada: '06:00', salida: '14:00' }, vie: { activo: false },
      sab: { activo: false }, dom: { activo: false },
    },
    tolerancia_minutos: 0,
    horario_activo: true,
  }
  const source = {
    registro_asistencia: records(),
    empleados: [{ id: EMPLOYEE, cliente_id: TENANT }],
    devices: [{ id: DEVICE, cliente_id: TENANT, timezone: 'America/Cancun' }],
    empleados_horarios: [{ id: 'assignment', cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: SCHEDULE, schedule_revision_id: 'revision-1', fecha_inicio: '2026-01-01', fecha_fin: null, activo: true }],
    schedule_revisions: [{ id: 'revision-1', cliente_id: TENANT, horario_id: SCHEDULE, version: 1, config_snapshot: revisionSnapshot, integrity_hash: computeScheduleRevisionIntegrityHash(revisionSnapshot) }],
    horarios: [{ id: SCHEDULE, cliente_id: TENANT, nombre: 'Schedule', tolerancia_minutos: 0, activo: true, dias_config: { jue: { activo: true, entrada: '06:00', salida: '14:00' } } }],
    ...data,
  }
  return {
    from(table) {
      const builder = {
        select() { return this }, eq() { return this }, gte() { return this }, lte() { return this },
        in() { return this }, or() { return this }, order() { return this },
        maybeSingle: async () => ({ data: table === 'registro_asistencia' ? source[table].find((row) => row.id === REGISTRO) || null : source[table]?.[0] || null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: source[table] || [], error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

async function trace() {
  return runProductionEngineShadowTrace(REGISTRO, environment(), { createClient: () => fakeClient() })
}

test('1. trace retains all 16 input events', async () => {
  const report = await trace()
  assert.equal(report.inputEventCount, 16)
  assert.equal(report.trace.eventTrace.length, 16)
})

test('2. event trace is timestamp then id chronological', async () => {
  const events = (await trace()).trace.eventTrace
  assert.deepEqual(events, events.slice().sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc) || a.registro_id.localeCompare(b.registro_id)))
})

test('3. trace contains neither raw payload nor biometric data', async () => {
  const serialized = JSON.stringify(await trace())
  assert.doesNotMatch(serialized, /raw_payload|forbidden|template|huella|rostro/i)
})

test('4. worked minutes reconcile to actual WORK segments, not gross span', async () => {
  const reconciliation = (await trace()).trace.reconciliations
  assert.equal(reconciliation.workedMinutesReconciles, true)
  assert.equal(reconciliation.workedMinutes, reconciliation.workSegmentMinutes)
  assert.notEqual(reconciliation.workedMinutes, reconciliation.spanMinutes)
})

test('5. break minutes reconcile to actual BREAK segments', async () => {
  const reconciliation = (await trace()).trace.reconciliations
  assert.equal(reconciliation.breakMinutesReconciles, true)
  assert.equal(reconciliation.breakMinutes, reconciliation.breakSegmentMinutes)
})

test('6. unmatched events remain visible in the pairing trace', async () => {
  const report = await trace()
  assert.ok(report.trace.unmatchedExits.length > 0)
  assert.equal(report.trace.pairingTrace.some((event) => event.action.includes('UNMATCHED_EXIT')), true)
})

test('7. first-in provenance is a sanitized event record', async () => {
  const source = (await trace()).trace.firstInSourceEvent
  assert.ok(source)
  assert.equal(typeof source.registro_id, 'string')
  assert.equal(typeof source.timestamp_utc, 'string')
})

test('8. last-out and state provenance are explicit', async () => {
  const state = (await trace()).trace.finalState
  assert.equal(Object.hasOwn(state, 'lastOut'), true)
  assert.equal(typeof state.provenance, 'string')
})

test('9. full trace is deterministic across the built-in replay', async () => {
  assert.equal((await trace()).deterministicReplay, true)
})

test('10. trace preserves the zero-write counters', async () => {
  const report = await trace()
  assert.deepEqual([report.writeCalls, report.persistenceCalls, report.rpcWriteCalls, report.incidentWriteCalls], [0, 0, 0, 0])
})

test('11. credentials never appear in trace output', async () => {
  assert.doesNotMatch(JSON.stringify(await trace()), /test-only-not-a-real-secret|serviceRoleKey/i)
})

test('12. pairing incidents are exposed as deterministic calculation warnings', async () => {
  const report = await trace()
  assert.ok(report.trace.pairingIncidents.length > 0)
  assert.ok(report.calculationWarnings.length > 0)
  assert.equal(report.trace.warningCoverage, 'ADEQUATE')
})
