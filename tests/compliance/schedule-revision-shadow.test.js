import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ScheduleResolver,
  computeScheduleRevisionIntegrityHash,
  legacyLiveScheduleToShadowShift,
  compareRevisionResolutionToLegacyShadow,
} from '../../src/domain/attendance/index.ts'

const TENANT = 'tenant-c'
const EMPLOYEE = 'employee-c'
const SCHEDULE = 'schedule-c'
const REVISION = 'revision-c'
const assignment = {
  id: 'assignment-c', cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: SCHEDULE,
  schedule_revision_id: REVISION, fecha_inicio: '2026-09-09', fecha_fin: null, activo: true,
}
const snapshot = {
  calculation_contract_version: 1,
  dias_config: {
    lun: { activo: true, entrada: '09:00', salida: '18:00' }, mar: { activo: true, entrada: '09:00', salida: '18:00' },
    mie: { activo: true, entrada: '09:00', salida: '18:00' }, jue: { activo: true, entrada: '09:00', salida: '18:00' },
    vie: { activo: true, entrada: '09:00', salida: '18:00' }, sab: { activo: false }, dom: { activo: false },
  }, tolerancia_minutos: 10, horario_activo: true,
}
const revision = { id: REVISION, cliente_id: TENANT, horario_id: SCHEDULE, version: 1, config_snapshot: snapshot, integrity_hash: computeScheduleRevisionIntegrityHash(snapshot) }
const live = { id: SCHEDULE, activo: true, tolerancia_minutos: 10, dias_config: snapshot.dias_config }

function comparison(date) {
  const resolved = ScheduleResolver.resolve({ clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate: date, assignments: [assignment], revisions: [revision] })
  return compareRevisionResolutionToLegacyShadow(resolved, legacyLiveScheduleToShadowShift(live, date))
}

test('shadow parity compares only schedule semantics: Monday, Saturday and Sunday agree', () => {
  for (const date of ['2026-09-14', '2026-09-12', '2026-09-13']) assert.equal(comparison(date).equal, true)
})

test('shadow identifies a live-parent change without using it as resolver fallback', () => {
  const changedLive = { ...live, tolerancia_minutos: 11 }
  const resolved = ScheduleResolver.resolve({ clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate: '2026-09-14', assignments: [assignment], revisions: [revision] })
  const report = compareRevisionResolutionToLegacyShadow(resolved, legacyLiveScheduleToShadowShift(changedLive, '2026-09-14'))
  assert.equal(report.equal, false)
  assert.equal(resolved.kind, 'SCHEDULED')
  assert.equal(resolved.shift.toleranceMinutes, 10)
})

test('read-only scripts contain no DML and keep production activation disabled', () => {
  const shadow = readFileSync(new URL('../../scripts/run-schedule-revision-shadow.mjs', import.meta.url), 'utf8')
  const parity = readFileSync(new URL('../../scripts/verify-schedule-revision-hash-parity.mjs', import.meta.url), 'utf8')
  const precheck = readFileSync(new URL('../../database/live-schema/58_schedule_resolver_revision_precheck.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(shadow + parity, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|upsert_workday_record/i)
  assert.match(shadow, /resolverActivated: false/)
  assert.match(shadow, /persistCanarySelected: false/)
  assert.match(shadow, /engineActivated: false/)
  assert.match(parity, /schedule_revision_calculation_hash/)
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(precheck, /ROLLBACK;/)
  assert.match(precheck, /FROM comparison p CROSS JOIN approval a;/)
  assert.match(precheck, /09df6a75-e231-4654-ae70-8448bdf2c312/)
  assert.match(precheck, /77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866/)
})
