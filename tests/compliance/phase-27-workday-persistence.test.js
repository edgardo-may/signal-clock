/**
 * Phase 27 contract tests. They use an in-memory RPC boundary only and never
 * connect to Supabase or execute the production SQL scripts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const {
  WorkdayPersistenceService,
  WorkdayPersistenceError,
  workdayPersistenceIdentity,
  toUpsertWorkdayRpcParams,
} = require('../../backend/services/attendance/WorkdayPersistenceService.js')

function workdayRecord(overrides = {}) {
  return {
    registro_id: 'registro-a',
    cliente_id: 'tenant-a',
    empleado_id: 'employee-a',
    workday_date: '2026-09-04',
    schedule_id: 'schedule-a',
    timezone: 'America/Cancun',
    first_in: '2026-09-04T13:00:00.000Z',
    last_out: '2026-09-04T22:00:00.000Z',
    worked_minutes: 540,
    break_minutes: 0,
    overtime_minutes: 60,
    late_minutes: 0,
    early_leave_minutes: 0,
    status: 'COMPLETE',
    integrity_hash: 'hash-a',
    calculation_version: 3,
    source_observed_at: '2026-09-04T22:00:00.000Z',
    source_event_count: 2,
    ...overrides,
  }
}

function rpcClient(reply) {
  const calls = []
  return {
    calls,
    client: {
      rpc: async (name, params) => {
        calls.push({ name, params })
        return typeof reply === 'function' ? reply(name, params, calls.length) : reply
      },
    },
  }
}

function rpcRow(persistenceResult, overrides = {}) {
  return {
    workday_id: '00000000-0000-0000-0000-000000000001',
    persistence_result: persistenceResult,
    integrity_hash: 'hash-a',
    ...overrides,
  }
}

test('1. valid adapter output accepts INSERTED', async () => {
  const mock = rpcClient({ data: [rpcRow('INSERTED')], error: null })
  const result = await new WorkdayPersistenceService(mock.client).persist(workdayRecord())

  assert.equal(result.persistenceResult, 'INSERTED')
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].name, 'upsert_workday_record')
  assert.equal(mock.calls[0].params.p_cliente_id, 'tenant-a')
  assert.equal(mock.calls[0].params.p_registro_id, 'registro-a')
  assert.equal(mock.calls[0].params.p_calculation_version, 3)
  assert.equal(mock.calls[0].params.p_integrity_hash, 'hash-a')
})

test('2. evolved V3 adapter accepts UPDATED from the RPC boundary', async () => {
  const mock = rpcClient({ data: [rpcRow('UPDATED', { integrity_hash: 'hash-b' })], error: null })
  const result = await new WorkdayPersistenceService(mock.client).persist(workdayRecord({ integrity_hash: 'hash-b' }))
  assert.equal(result.persistenceResult, 'UPDATED')
  assert.equal(mock.calls.length, 1)
})

test('3. valid adapter output accepts UNCHANGED with one RPC call only', async () => {
  const mock = rpcClient({ data: [rpcRow('UNCHANGED')], error: null })
  const result = await new WorkdayPersistenceService(mock.client).persist(workdayRecord())

  assert.equal(result.persistenceResult, 'UNCHANGED')
  assert.equal(mock.calls.length, 1)
})

test('4. an unknown RPC response fails closed', async () => {
  const mock = rpcClient({ data: [rpcRow('CREATED')], error: null })

  await assert.rejects(
    () => new WorkdayPersistenceService(mock.client).persist(workdayRecord()),
    (error) => error instanceof WorkdayPersistenceError
      && error.code === 'WORKDAY_PERSISTENCE_RESPONSE_INVALID'
  )
})

test('5. an RPC error propagates without direct-write fallback', async () => {
  const mock = rpcClient({ data: null, error: { message: 'permission denied' } })

  await assert.rejects(
    () => new WorkdayPersistenceService(mock.client).persist(workdayRecord()),
    (error) => error instanceof WorkdayPersistenceError
      && error.code === 'WORKDAY_PERSISTENCE_RPC_ERROR'
  )
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].name, 'upsert_workday_record')
})

test('6. p_status comes from WorkdayState', () => {
  const params = toUpsertWorkdayRpcParams(
    workdayRecord({ status: 'INCOMPLETE', workdayStatus: 'LATE' })
  )

  assert.equal(params.p_status, 'INCOMPLETE')
})

test('7. deprecated WorkdayStatus is not sent to the RPC', () => {
  const params = toUpsertWorkdayRpcParams(
    workdayRecord({ status: 'COMPLETE', workdayStatus: 'LATE' })
  )

  assert.equal(Object.hasOwn(params, 'p_workday_status'), false)
  assert.equal(Object.hasOwn(params, 'workday_status'), false)
})

test('8. V3 persistence requires schedule_id', () => {
  assert.throws(
    () => toUpsertWorkdayRpcParams(workdayRecord({ schedule_id: null })),
    (error) => error instanceof WorkdayPersistenceError && error.code === 'WORKDAY_PERSISTENCE_INPUT_INVALID'
  )
})

test('9. logical identity excludes schedule_id', () => {
  const first = workdayPersistenceIdentity(workdayRecord({ schedule_id: 'schedule-a' }))
  const second = workdayPersistenceIdentity(workdayRecord({ schedule_id: 'schedule-b' }))

  assert.deepEqual(first, second)
  assert.equal(Object.hasOwn(first, 'schedule_id'), false)
})

test('10. a changed snapshot may return UPDATED without a legacy fallback', async () => {
  const mock = rpcClient({ data: [rpcRow('UPDATED')], error: null })
  const result = await new WorkdayPersistenceService(mock.client).persist(workdayRecord({ schedule_id: 'schedule-b' }))
  assert.equal(result.persistenceResult, 'UPDATED')
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].name, 'upsert_workday_record')
})

test('11. missing V3 identity, hash, or version fails before any RPC call', async () => {
  for (const field of ['registro_id', 'cliente_id', 'empleado_id', 'workday_date', 'schedule_id', 'integrity_hash']) {
    const mock = rpcClient({ data: [rpcRow('INSERTED')], error: null })
    await assert.rejects(
      () => new WorkdayPersistenceService(mock.client).persist(workdayRecord({ [field]: '' })),
      (error) => error instanceof WorkdayPersistenceError
    )
    assert.equal(mock.calls.length, 0)
  }
  for (const version of [undefined, 2, 4]) {
    const mock = rpcClient({ data: [rpcRow('INSERTED')], error: null })
    await assert.rejects(
      () => new WorkdayPersistenceService(mock.client).persist(workdayRecord({ calculation_version: version })),
      (error) => error instanceof WorkdayPersistenceError && error.code === 'WORKDAY_PERSISTENCE_VERSION_INVALID'
    )
    assert.equal(mock.calls.length, 0)
  }
})

test('12. service layer has no authenticated direct-write path', async () => {
  const source = await readFile(
    new URL('../../backend/services/attendance/WorkdayPersistenceService.js', import.meta.url),
    'utf8'
  )

  assert.equal(source.includes('.from('), false)
  assert.equal(source.includes('createClient('), false)
  assert.equal(source.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.match(source, /rpc\('upsert_workday_record'/)
  assert.match(source, /p_calculation_version/)
  assert.match(source, /p_registro_id/)
  assert.doesNotMatch(source, /legacy/i)
})

test('13. RPC SQL contract is SECURITY INVOKER, service_role-only, and avoids unchanged updates', async () => {
  const sql = await readFile(
    new URL('../../database/live-schema/28_workday_persistence_rpc.sql', import.meta.url),
    'utf8'
  )

  assert.match(sql, /SECURITY INVOKER/)
  assert.doesNotMatch(sql, /SECURITY DEFINER/)
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/)
  assert.match(sql, /ON CONFLICT \(cliente_id, empleado_id, workday_date\) DO NOTHING/)
  assert.match(sql, /IS DISTINCT FROM/)
  assert.match(sql, /'UNCHANGED'/)
})

test('14. V3 payload maps every canonical field without legacy aliases', () => {
  assert.deepEqual(toUpsertWorkdayRpcParams(workdayRecord()), {
    p_registro_id: 'registro-a',
    p_cliente_id: 'tenant-a',
    p_empleado_id: 'employee-a',
    p_workday_date: '2026-09-04',
    p_schedule_id: 'schedule-a',
    p_timezone: 'America/Cancun',
    p_first_in: '2026-09-04T13:00:00.000Z',
    p_last_out: '2026-09-04T22:00:00.000Z',
    p_worked_minutes: 540,
    p_break_minutes: 0,
    p_overtime_minutes: 60,
    p_late_minutes: 0,
    p_early_leave_minutes: 0,
    p_status: 'COMPLETE',
    p_integrity_hash: 'hash-a',
    p_calculation_version: 3,
    p_source_observed_at: '2026-09-04T22:00:00.000Z',
    p_source_event_count: 2,
  })
})
