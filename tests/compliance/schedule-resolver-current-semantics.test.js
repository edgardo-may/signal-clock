import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScheduleResolver } from '../../src/domain/attendance/adapters/ScheduleResolver.ts'
import { computeScheduleRevisionIntegrityHash } from '../../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const TENANT = 'tenant-a'
const EMPLOYEE = 'employee-a'
const C_ASSIGNMENT = '2984316c-1c93-4f66-853e-349f90b9f82c'
const C_SCHEDULE = '5a753368-f019-4230-89e2-79beaa39ff0f'
const C_REVISION = '09df6a75-e231-4654-ae70-8448bdf2c312'

function days(overrides = {}) {
  const inactive = { activo: false }
  return {
    lun: { activo: true, entrada: '09:00', salida: '18:00' }, mar: { activo: true, entrada: '09:00', salida: '18:00' },
    mie: { activo: true, entrada: '09:00', salida: '18:00' }, jue: { activo: true, entrada: '09:00', salida: '18:00' },
    vie: { activo: true, entrada: '09:00', salida: '18:00' }, sab: inactive, dom: inactive, ...overrides,
  }
}

function snapshot(overrides = {}) {
  return { calculation_contract_version: 1, dias_config: days(), tolerancia_minutos: 10, horario_activo: true, ...overrides }
}

function revision(overrides = {}) {
  const config_snapshot = overrides.config_snapshot || snapshot()
  return {
    id: C_REVISION, cliente_id: TENANT, horario_id: C_SCHEDULE, version: 1,
    config_snapshot, integrity_hash: computeScheduleRevisionIntegrityHash(config_snapshot), ...overrides,
  }
}

function assignment(overrides = {}) {
  return {
    id: C_ASSIGNMENT, cliente_id: TENANT, empleado_id: EMPLOYEE, horario_id: C_SCHEDULE, schedule_revision_id: C_REVISION,
    fecha_inicio: '2026-09-09', fecha_fin: null, activo: true, ...overrides,
  }
}

function resolve(candidateDate, assignments = [assignment()], revisions = [revision()]) {
  return ScheduleResolver.resolve({ clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate, assignments, revisions })
}

test('1. C revision v1 resolves Monday 09:00–18:00 with tolerance 10', () => {
  const result = resolve('2026-09-14')
  assert.equal(result.kind, 'SCHEDULED')
  assert.equal(result.scheduleAssignmentId, C_ASSIGNMENT)
  assert.equal(result.scheduleRevisionId, C_REVISION)
  assert.equal(result.scheduleRevisionVersion, 1)
  assert.equal(result.shift.startTime, '09:00')
  assert.equal(result.shift.endTime, '18:00')
  assert.equal(result.shift.toleranceMinutes, 10)
})

test('2. C Saturday is legitimately UNSCHEDULED', () => assert.deepEqual(resolve('2026-09-12'), { kind: 'UNSCHEDULED', candidateDate: '2026-09-12' }))
test('3. C Sunday is legitimately UNSCHEDULED', () => assert.deepEqual(resolve('2026-09-13'), { kind: 'UNSCHEDULED', candidateDate: '2026-09-13' }))
test('4. no applicable assignment is legitimately UNSCHEDULED', () => assert.deepEqual(resolve('2026-09-08'), { kind: 'UNSCHEDULED', candidateDate: '2026-09-08' }))

test('5. active applicable assignment without revision fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment({ schedule_revision_id: null })]), (error) => error?.code === 'SCHEDULE_REVISION_REQUIRED')
})

test('6. missing revision fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], []), (error) => error?.code === 'SCHEDULE_REVISION_NOT_FOUND')
})

test('7. revision integrity hash mismatch fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ integrity_hash: '0'.repeat(64) })]), (error) => error?.code === 'SCHEDULE_REVISION_HASH_MISMATCH')
})

test('8. revision tenant mismatch fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ cliente_id: 'tenant-b' })]), (error) => error?.code === 'SCHEDULE_REVISION_TENANT_MISMATCH')
})

test('9. revision schedule mismatch fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ horario_id: 'other-schedule' })]), (error) => error?.code === 'SCHEDULE_REVISION_SCHEDULE_MISMATCH')
})

test('10. unknown calculation contract version fails closed', () => {
  const bad = snapshot({ calculation_contract_version: 2 })
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ config_snapshot: bad })]), (error) => error?.code === 'SCHEDULE_REVISION_CONTRACT_VERSION_UNSUPPORTED')
})

test('11. incomplete snapshot fails closed', () => {
  const bad = { calculation_contract_version: 1, dias_config: days(), horario_activo: true }
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ config_snapshot: bad, integrity_hash: 'a'.repeat(64) })]), (error) => error?.code === 'SCHEDULE_REVISION_SNAPSHOT_INVALID')
})

test('12. VOIDED A/B rows without revisions are ignored', () => {
  const voided = [
    assignment({ id: 'a290fc73-7ee6-4ea8-9e0e-8e92a683245f', schedule_revision_id: null, activo: false }),
    assignment({ id: '56f8c98d-5fe1-49d2-abe2-42182a4a830a', schedule_revision_id: null, activo: false }),
  ]
  const result = resolve('2026-09-14', [...voided, assignment()])
  assert.equal(result.kind, 'SCHEDULED')
})

test('13. two applicable active assignments fail closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment(), assignment({ id: 'second' })]), (error) => error?.code === 'AMBIGUOUS_SCHEDULE')
})

test('14. a closed historical assignment resolves through its own revision', () => {
  const historic = assignment({ fecha_inicio: '2026-09-01', fecha_fin: '2026-09-10' })
  const result = resolve('2026-09-10', [historic])
  assert.equal(result.kind, 'SCHEDULED')
  assert.equal(result.scheduleRevisionId, C_REVISION)
})

test('15. an invalid active assignment range fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment({ fecha_fin: '2026-09-08' })]), (error) => error?.code === 'SHIFT_CONFIG_ERROR')
})

test('16. parent live schedule data is not an input and cannot alter resolution', () => {
  const baseline = resolve('2026-09-14')
  const withIgnoredLegacyData = ScheduleResolver.resolve({
    clienteId: TENANT, empleadoId: EMPLOYEE, candidateDate: '2026-09-14', assignments: [assignment()], revisions: [revision()],
    schedules: [{ dias_config: { lun: { activo: true, entrada: '00:00', salida: '00:01' } }, tolerancia_minutos: 999, activo: false }],
  })
  assert.deepEqual(withIgnoredLegacyData, baseline)
})

test('17. same immutable input has the same schedule result', () => assert.deepEqual(resolve('2026-09-14'), resolve('2026-09-14')))

test('18. hash is deterministic and changes for calculation data', () => {
  const original = snapshot()
  assert.equal(computeScheduleRevisionIntegrityHash(original), computeScheduleRevisionIntegrityHash({ ...original, dias_config: days() }))
  assert.notEqual(computeScheduleRevisionIntegrityHash(original), computeScheduleRevisionIntegrityHash({ ...original, tolerancia_minutos: 11 }))
})

test('19. active overnight revision retains entry-date operative semantics', () => {
  const overnight = snapshot({ dias_config: days({ lun: { activo: true, entrada: '22:00', salida: '06:00' } }) })
  const result = resolve('2026-09-14', [assignment()], [revision({ config_snapshot: overnight })])
  assert.equal(result.kind, 'SCHEDULED')
  assert.equal(result.shift.operativeDate, '2026-09-14')
  assert.equal(result.shift.endTime, '06:00')
})

test('20. duplicate revision rows fail closed instead of selecting an arbitrary copy', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision(), revision()]), (error) => error?.code === 'SCHEDULE_REVISION_AMBIGUOUS')
})

test('21. an invalid revision version fails closed', () => {
  assert.throws(() => resolve('2026-09-14', [assignment()], [revision({ version: 0 })]), (error) => error?.code === 'SCHEDULE_REVISION_VERSION_INVALID')
})
