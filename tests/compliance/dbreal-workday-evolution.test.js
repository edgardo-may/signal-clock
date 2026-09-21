import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import {
  assertFunctionPrivileges,
  callWorkdayEvolution,
  closeWorkdayEvolutionDbreal,
  createCanonicalRegistro,
  disableFixturePersistGate,
  enableFixturePersistGate,
  evolutionPayload,
  prepareWorkdayEvolutionDbreal,
  workdayEvolutionDbrealConfig,
  workdayState
} from '../helpers/workdayEvolutionDbreal.js'

const config = workdayEvolutionDbrealConfig()
const options = config.ready ? {} : { skip: config.skipReason }
let context
let initial
let evolved

async function expectRuntimeError(operation, code) {
  await assert.rejects(operation, error => {
    assert.match(String(error?.message || error), new RegExp(code))
    return true
  })
}

before(options, async () => { context = await prepareWorkdayEvolutionDbreal() })
after(options, async () => { await closeWorkdayEvolutionDbreal(context) })

test('DBWE-001 applies Phase 96, Phase 97, and Phase 98 only to the guarded isolated database', options, () => {
  assert.equal(context.precheck.pass, true)
  assert.equal(context.postcheck.pass, true)
})

test('DBWE-002 INSERTED creates one workday and one INSERTED history row', options, async () => {
  const registro = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-10T14:00:00.000Z' })
  initial = evolutionPayload(context.fixture, registro.id)
  const result = await callWorkdayEvolution(context.service, initial)
  const current = await workdayState(context.client, context.fixture)
  assert.equal(result.persistence_result, 'INSERTED')
  assert.ok(result.workday_id)
  assert.equal(current.id, result.workday_id)
  assert.equal(current.history_count, 1)
  assert.equal(current.last_history_action, 'INSERTED')
})

test('DBWE-003 identical INSERTED replay is UNCHANGED and has no new history', options, async () => {
  const beforeState = await workdayState(context.client, context.fixture)
  const result = await callWorkdayEvolution(context.service, initial)
  const afterState = await workdayState(context.client, context.fixture)
  assert.equal(result.persistence_result, 'UNCHANGED')
  assert.equal(result.workday_id, beforeState.id)
  assert.equal(afterState.history_count, 1)
})

test('DBWE-004 a later second canonical event produces UPDATED on the same identity', options, async () => {
  const registro = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-10T23:00:00.000Z' })
  evolved = evolutionPayload(context.fixture, registro.id, {
    last_out: '2030-06-10T23:00:00.000Z', worked_minutes: 540, status: 'COMPLETE',
    source_observed_at: '2030-06-10T23:00:00.000Z', source_event_count: 2
  })
  const result = await callWorkdayEvolution(context.service, evolved)
  const current = await workdayState(context.client, context.fixture)
  assert.equal(result.persistence_result, 'UPDATED')
  assert.equal(current.id, result.workday_id)
  assert.equal(current.last_out.toISOString(), '2030-06-10T23:00:00.000Z')
  assert.equal(current.worked_minutes, 540)
  assert.equal(current.history_count, 2)
  assert.equal(current.last_history_action, 'UPDATED')
})

test('DBWE-005 exact UPDATED replay is UNCHANGED and leaves history immutable', options, async () => {
  const result = await callWorkdayEvolution(context.service, evolved)
  assert.equal(result.persistence_result, 'UNCHANGED')
  assert.equal((await workdayState(context.client, context.fixture)).history_count, 2)
})

test('DBWE-006 an older snapshot is STALE and cannot regress the current workday', options, async () => {
  const beforeState = await workdayState(context.client, context.fixture)
  const result = await callWorkdayEvolution(context.service, initial)
  const afterState = await workdayState(context.client, context.fixture)
  assert.equal(result.persistence_result, 'STALE')
  assert.equal(result.workday_id, beforeState.id)
  assert.equal(afterState.integrity_hash, beforeState.integrity_hash)
  assert.equal(afterState.history_count, beforeState.history_count)
})

test('DBWE-007 a delayed event at the same watermark with a higher count is UPDATED', options, async () => {
  const registro = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-10T22:45:00.000Z' })
  evolved = evolutionPayload(context.fixture, registro.id, {
    last_out: '2030-06-11T00:00:00.000Z', worked_minutes: 600, status: 'COMPLETE',
    source_observed_at: '2030-06-10T23:00:00.000Z', source_event_count: 3
  })
  const result = await callWorkdayEvolution(context.service, evolved)
  const current = await workdayState(context.client, context.fixture)
  assert.equal(result.persistence_result, 'UPDATED')
  assert.equal(current.id, result.workday_id)
  assert.equal(current.history_count, 3)
})

test('DBWE-008 equal source version with different content raises PERSIST_SNAPSHOT_CONFLICT', options, async () => {
  const beforeState = await workdayState(context.client, context.fixture)
  const conflict = evolutionPayload(context.fixture, evolved.registro_id, { ...evolved, worked_minutes: 601, integrity_hash: undefined })
  await expectRuntimeError(() => callWorkdayEvolution(context.service, conflict), 'PERSIST_SNAPSHOT_CONFLICT')
  const afterState = await workdayState(context.client, context.fixture)
  assert.equal(afterState.integrity_hash, beforeState.integrity_hash)
  assert.equal(afterState.history_count, beforeState.history_count)
})

test('DBWE-009 concurrent INSERTs converge to one INSERTED and one history identity', options, async () => {
  const registro = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-11T14:00:00.000Z' })
  const payload = evolutionPayload(context.fixture, registro.id, { workday_date: '2030-06-11', source_observed_at: '2030-06-11T14:00:00.000Z' })
  const results = await Promise.all(Array.from({ length: 6 }, () => callWorkdayEvolution(context.service, payload)))
  assert.equal(results.filter(result => result.persistence_result === 'INSERTED').length, 1)
  assert.equal(results.filter(result => result.persistence_result === 'UNCHANGED').length, 5)
  assert.equal((await workdayState(context.client, context.fixture, '2030-06-11')).history_count, 1)
})

test('DBWE-010 concurrent UPDATEs converge to one UPDATED and a single appended history row', options, async () => {
  const registro = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-11T23:00:00.000Z' })
  const payload = evolutionPayload(context.fixture, registro.id, {
    workday_date: '2030-06-11', last_out: '2030-06-11T23:00:00.000Z', worked_minutes: 540, status: 'COMPLETE',
    source_observed_at: '2030-06-11T23:00:00.000Z', source_event_count: 2
  })
  const results = await Promise.all(Array.from({ length: 6 }, () => callWorkdayEvolution(context.service, payload)))
  assert.equal(results.filter(result => result.persistence_result === 'UPDATED').length, 1)
  assert.equal(results.filter(result => result.persistence_result === 'UNCHANGED').length, 5)
  const current = await workdayState(context.client, context.fixture, '2030-06-11')
  assert.equal(current.history_count, 2)
  assert.equal(current.last_history_action, 'UPDATED')
})

test('DBWE-011 denies tenant B when the canonical registro belongs to tenant A', options, async () => {
  await expectRuntimeError(() => callWorkdayEvolution(context.service, { ...evolved, cliente_id: context.fixture.tenantB.id }), 'PERSIST_SOURCE_EVENT_DENIED')
})

test('DBWE-012 the PERSIST_ACTIVE gate is tenant-scoped, revocable, and restored only for this fixture', options, async () => {
  await disableFixturePersistGate(context.client, context.fixture.tenantA.id)
  await expectRuntimeError(() => callWorkdayEvolution(context.service, evolved), 'PERSIST_AUTHORIZATION_DENIED')
  await enableFixturePersistGate(context.client, context.fixture.tenantA.id)
  assert.equal((await callWorkdayEvolution(context.service, evolved)).persistence_result, 'UNCHANGED')
})

test('DBWE-013 absent, foreign, non-ZKTECO, and non-PROCESSED source events fail closed', options, async () => {
  await disableFixturePersistGate(context.client, context.fixture.tenantA.id)
  try {
    const noSource = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-12T14:00:00.000Z', withSource: false })
    await expectRuntimeError(() => callWorkdayEvolution(context.service, evolutionPayload(context.fixture, noSource.id, { workday_date: '2030-06-12' })), 'PERSIST_SOURCE_EVENT_DENIED')
    const foreign = await createCanonicalRegistro(context.client, context.fixture, { tenant: context.fixture.tenantB, employee: context.fixture.employeeB, device: context.fixture.deviceB, occurredAt: '2030-06-12T14:30:00.000Z' })
    await expectRuntimeError(() => callWorkdayEvolution(context.service, evolutionPayload(context.fixture, foreign.id, { workday_date: '2030-06-12' })), 'PERSIST_SOURCE_EVENT_DENIED')
    const manual = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-12T15:00:00.000Z', sourceType: 'MANUAL' })
    await expectRuntimeError(() => callWorkdayEvolution(context.service, evolutionPayload(context.fixture, manual.id, { workday_date: '2030-06-12' })), 'PERSIST_SOURCE_EVENT_DENIED')
    const pending = await createCanonicalRegistro(context.client, context.fixture, { occurredAt: '2030-06-12T16:00:00.000Z', processingStatus: 'PENDING' })
    await expectRuntimeError(() => callWorkdayEvolution(context.service, evolutionPayload(context.fixture, pending.id, { workday_date: '2030-06-12' })), 'PERSIST_SOURCE_EVENT_DENIED')
    await expectRuntimeError(() => callWorkdayEvolution(context.service, { ...evolved, registro_id: randomUUID() }), 'PERSIST_SOURCE_EVENT_DENIED')
  } finally {
    await enableFixturePersistGate(context.client, context.fixture.tenantA.id)
  }
})

test('DBWE-014 invalid schedule and an ambiguous assignment both fail revision resolution', options, async () => {
  await expectRuntimeError(() => callWorkdayEvolution(context.service, { ...evolved, schedule_id: randomUUID() }), 'PERSIST_REVISION_RESOLUTION_DENIED')
  const duplicate = await context.client.query(`
    INSERT INTO public.empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,activo,schedule_revision_id)
    VALUES($1,$2,$3,'2030-01-01',true,$4) RETURNING id
  `, [context.fixture.tenantA.id, context.fixture.employee.id, context.fixture.schedule.id, context.fixture.revision.id])
  try {
    await expectRuntimeError(() => callWorkdayEvolution(context.service, evolved), 'PERSIST_REVISION_RESOLUTION_DENIED')
  } finally {
    await context.client.query(`DELETE FROM public.empleados_horarios WHERE id=$1`, [duplicate.rows[0].id])
  }
})

test('DBWE-015 grants only service_role the new 18-argument RPC and revokes the old 16-argument RPC', options, async () => {
  const privileges = await assertFunctionPrivileges(context.client)
  assert.equal(privileges.anon_execute, false)
  assert.equal(privileges.authenticated_execute, false)
  assert.equal(privileges.public_execute, false)
  assert.equal(privileges.service_role_execute, true)
  assert.equal(privileges.legacy_service_role_execute, false)
})
