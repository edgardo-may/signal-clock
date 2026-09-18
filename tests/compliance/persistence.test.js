import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { WorkdayPersistenceService } from '../../src/services/attendance/WorkdayPersistenceService.ts'

/**
 * Historical simulated persistence was replaced in Phase 35.5C.
 *
 * The browser-reachable service is deliberately server-only. The approved
 * persistence contract lives behind the backend-only RPC and has its own
 * static/isolated-DB coverage. These tests preserve each original safety
 * intent without pretending that a client-side mock can create records.
 */
class ClientRpcSpy {
  rpcCalls = 0

  async rpc() {
    this.rpcCalls += 1
    throw new Error('The browser persistence guard must prevent this call.')
  }
}

const TENANT_A = 't-1111'
const TENANT_B = 't-2222'
const EMP_1 = 'e-1001'
const EMP_2 = 'e-1002'
const SCHEDULE_A = 's-9999'

const baseResult = {
  clienteId: TENANT_A,
  empleadoId: EMP_1,
  operativeDate: '2027-02-23',
  timezone: 'America/Mexico_City',
  scheduleAssignmentId: SCHEDULE_A,
  shiftType: 'DIURNA',
  isRestDay: false,
  isHoliday: false,
  scheduledMinutes: 480,
  workedMinutes: 480,
  breakMinutes: 0,
  effectiveMinutes: 480,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  ordinaryMinutes: 480,
  overtimeMinutes: 0,
  nightShiftMinutes: 0,
  workdayState: 'COMPLETE',
  calculationVersion: 3,
  integrityHash: 'fixture-hash-v3',
  sourceLogIds: ['log-1', 'log-2'],
  punchDispositions: [{ logId: 'log-1', disposition: 'CANONICAL_FIRST_IN' }],
  incidents: [],
  warnings: [],
}

async function expectServerOnly(result = baseResult) {
  const client = new ClientRpcSpy()
  const response = await WorkdayPersistenceService.persistWorkday(client, result)
  assert.deepEqual(response, {
    status: 'ERROR',
    error: 'WORKDAY_PERSISTENCE_SERVER_ONLY',
  })
  assert.equal(client.rpcCalls, 0)
}

describe('FASE 2: Persistencia Workday Records (V3 server-only contract)', () => {
  test('PERSIST-001: browser-reachable persistence cannot create a workday record', async () => {
    await expectServerOnly()
  })

  test('PERSIST-002: an identical replay remains blocked rather than reporting UNCHANGED locally', async () => {
    await expectServerOnly()
  })

  test('PERSIST-003: repeated client attempts make zero RPC calls and create no local history', async () => {
    const client = new ClientRpcSpy()
    for (let index = 0; index < 10; index += 1) {
      const response = await WorkdayPersistenceService.persistWorkday(client, baseResult)
      assert.equal(response.status, 'ERROR')
    }
    assert.equal(client.rpcCalls, 0)
  })

  test('PERSIST-004: a changed V3 integrity hash cannot trigger a client-side version update', async () => {
    await expectServerOnly({ ...baseResult, integrityHash: 'fixture-hash-v3-changed', lateMinutes: 15 })
  })

  test('PERSIST-005: client simulation does not manufacture workday history', async () => {
    await expectServerOnly()
    await expectServerOnly({ ...baseResult, integrityHash: 'fixture-hash-v3-changed' })
  })

  test('PERSIST-006: a second tenant cannot bypass the backend-only persistence boundary', async () => {
    await expectServerOnly({ ...baseResult, clienteId: TENANT_B, integrityHash: 'tenant-b-v3' })
  })

  test('PERSIST-007: different logical identities remain unavailable to browser persistence', async () => {
    await expectServerOnly({ ...baseResult, scheduleAssignmentId: undefined, integrityHash: 'unscheduled-v3' })
  })

  test('PERSIST-008: canonical and supplemental dispositions are not stored by a client mock', async () => {
    await expectServerOnly({
      ...baseResult,
      punchDispositions: [
        { logId: 'log-1', disposition: 'CANONICAL_FIRST_IN' },
        { logId: 'log-2', disposition: 'CANONICAL_FIRST_OUT' },
        { logId: 'log-3', disposition: 'SUPPLEMENTAL' },
      ],
    })
  })

  test('PERSIST-009: calculation warnings and incidents are not written from the browser boundary', async () => {
    await expectServerOnly({
      ...baseResult,
      incidents: [{ code: 'LATE', message: 'Tarde' }],
      warnings: [{ code: 'ADDITIONAL_ENTRY' }],
    })
  })

  test('PERSIST-010: V3 workday state is not converted into a deprecated client-side status write', async () => {
    await expectServerOnly({ ...baseResult, empleadoId: EMP_2, workdayState: 'COMPLETE' })
  })

  test('PERSIST-011: invalid negative minutes cannot reach a browser RPC path', async () => {
    await expectServerOnly({ ...baseResult, empleadoId: 'e-invalid', workedMinutes: -10 })
  })

  test('PERSIST-013: collaborator scope is enforced by the real database contract, never a browser mock', async () => {
    await expectServerOnly({ ...baseResult, empleadoId: EMP_2 })
  })

  test('PERSIST-014: admin tenant scope is enforced by the real database contract, never a browser mock', async () => {
    await expectServerOnly({ ...baseResult, clienteId: TENANT_B })
  })

  test('PERSIST-017: concurrent browser attempts are all fail-closed and create no duplicate locally', async () => {
    const client = new ClientRpcSpy()
    const results = await Promise.all([
      WorkdayPersistenceService.persistWorkday(client, { ...baseResult, empleadoId: 'e-concurrent' }),
      WorkdayPersistenceService.persistWorkday(client, { ...baseResult, empleadoId: 'e-concurrent' }),
    ])
    assert.deepEqual(results.map((result) => result.status), ['ERROR', 'ERROR'])
    assert.equal(client.rpcCalls, 0)
  })

  test('PERSIST-018: a deterministic V3 hash replay cannot claim UNCHANGED outside the backend RPC', async () => {
    await expectServerOnly({ ...baseResult, empleadoId: 'e-1003', integrityHash: 'fixture-v3-deterministic' })
  })
})
