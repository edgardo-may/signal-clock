/** Phase 33 verifies readiness only. It makes no real Supabase connection. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const {
  AttendanceEngineOrchestrator,
  SupabaseAttendanceReadRepository,
} = require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const {
  APPROVED_REGISTRO_ID,
  ProductionShadowGuardError,
  readProductionShadowConfig,
  safeOutput,
} = require('../../backend/scripts/run-production-workday-shadow-canary.js')

const TENANT = '69095bd5-fee5-4237-a1a4-186dd88310ff'
const EMPLOYEE = '6c94a683-1fbd-4427-af9e-8ea154ea50fa'
const DEVICE = 'f693aea8-9f80-4e81-a99c-91b39e6d66d9'

function productionEnvironment(overrides = {}) {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-secret',
    SHADOW_CANARY_ALLOWED_HOST: 'project.example.supabase.co',
    SHADOW_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW',
    SHADOW_CANARY_CONFIRMATION: 'I_APPROVE_READ_ONLY_SHADOW',
    ...overrides,
  }
}

function sourceRegistro() {
  return {
    id: APPROVED_REGISTRO_ID, cliente_id: TENANT, empleado_id: EMPLOYEE, dispositivo_id: DEVICE,
    verificado_at: '2026-09-03T16:26:04.000Z', tipo_verificacion: 'entrada', metodo: 'face',
    source_event_id: 'source-candidate', raw_payload: { prohibited: true }, es_manual: false,
  }
}

function failBeforeSchedule(overrides = {}) {
  return {
    async loadRegistro() { return sourceRegistro() },
    async loadDevice() { return { id: DEVICE, cliente_id: TENANT, timezone: 'America/Cancun' } },
    async loadEmployee() { return { id: EMPLOYEE, cliente_id: TENANT } },
    ...overrides,
  }
}

function shadow(repository) {
  return new AttendanceEngineOrchestrator({ repository, mode: 'SHADOW', domain, logger: { info: () => {}, error: () => {} } })
}

function readClient(rows = []) {
  const calls = []
  const builder = {
    data: rows,
    error: null,
    select(columns) { calls.push(['select', columns]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    gte(column, value) { calls.push(['gte', column, value]); return this },
    lte(column, value) { calls.push(['lte', column, value]); return this },
    in(column, value) { calls.push(['in', column, value]); return this },
    or(value) { calls.push(['or', value]); return this },
    order(column, options) { calls.push(['order', column, options]); return this },
    maybeSingle: async () => ({ data: rows[0] || null, error: null }),
  }
  return { calls, client: { from(table) { calls.push(['from', table]); return builder } } }
}

test('1. runner requires the explicit approved registroId CLI shape', () => {
  const completed = spawnSync(process.execPath, ['backend/scripts/run-production-workday-shadow-canary.js'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(completed.status, 2)
  assert.match(completed.stderr, /--registro-id/)
})

test('2. PERSIST and mode CLI options do not exist', () => {
  for (const argument of ['--persist', '--mode', 'PERSIST']) {
    const completed = spawnSync(process.execPath, ['backend/scripts/run-production-workday-shadow-canary.js', argument], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8',
    })
    assert.equal(completed.status, 2)
  }
})

test('3. runner mode is hardcoded to SHADOW', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.match(source, /mode: 'SHADOW'/)
  assert.doesNotMatch(source, /process\.argv.*mode|--persist/)
})

test('4. destination mismatch fails closed before a client can be created', () => {
  assert.throws(
    () => readProductionShadowConfig(APPROVED_REGISTRO_ID, productionEnvironment({ SHADOW_CANARY_ALLOWED_HOST: 'wrong.example' })),
    (error) => error instanceof ProductionShadowGuardError && error.code === 'SHADOW_DESTINATION_DENIED'
  )
})

test('5. missing backend environment fails closed', () => {
  assert.throws(
    () => readProductionShadowConfig(APPROVED_REGISTRO_ID, {}),
    (error) => error.code === 'SHADOW_ENV_MISSING'
  )
})

test('6. any candidate other than the approved UUID fails closed', () => {
  assert.throws(
    () => readProductionShadowConfig('00000000-0000-4000-8000-000000000000', productionEnvironment()),
    (error) => error.code === 'SHADOW_CANDIDATE_DENIED'
  )
})

test('7. cross-tenant device blocks before any schedule lookup', async () => {
  const repository = failBeforeSchedule({ async loadDevice() { return { id: DEVICE, cliente_id: 'other', timezone: 'America/Cancun' } } })
  await assert.rejects(() => shadow(repository).run({ registroId: APPROVED_REGISTRO_ID }), (error) => error.code === 'TENANT_MISMATCH')
})

test('8. cross-tenant employee blocks before any schedule lookup', async () => {
  const repository = failBeforeSchedule({ async loadEmployee() { return { id: EMPLOYEE, cliente_id: 'other' } } })
  await assert.rejects(() => shadow(repository).run({ registroId: APPROVED_REGISTRO_ID }), (error) => error.code === 'TENANT_MISMATCH')
})

test('9. real repository exposes read operations and no write operation', () => {
  const methods = Object.getOwnPropertyNames(SupabaseAttendanceReadRepository.prototype)
  for (const name of ['getAttendanceById', 'getDeviceForTenant', 'getEmployeeForTenant', 'getScheduleAssignments', 'getAttendanceWindow']) {
    assert.equal(methods.includes(name), true)
  }
  assert.equal(methods.some((name) => /insert|update|delete|persist|rpc/i.test(name)), false)
})

test('10. runner dependency graph does not load the persistence implementation', async () => {
  const [runner, orchestrator, contract] = await Promise.all([
    readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/services/attendance/WorkdayPersistenceContract.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(runner + orchestrator + contract, /WorkdayPersistenceService\.js|upsert_workday_record/)
})

test('11. upsert RPC is unreachable from the runner source', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.rpc\(|upsert_workday_record/)
})

test('12. attendance window read constrains tenant, employee, and timestamps', async () => {
  const fake = readClient([])
  const repository = new SupabaseAttendanceReadRepository(fake.client)
  await repository.getAttendanceWindow(EMPLOYEE, TENANT, '2026-09-03T09:00:00.000Z', '2026-09-03T22:00:00.000Z')
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'eq'), [
    ['eq', 'cliente_id', TENANT], ['eq', 'empleado_id', EMPLOYEE],
  ])
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'gte' || call[0] === 'lte'), [
    ['gte', 'verificado_at', '2026-09-03T09:00:00.000Z'],
    ['lte', 'verificado_at', '2026-09-03T22:00:00.000Z'],
  ])
})

test('13. output is structured and sanitized', () => {
  const output = safeOutput({
    registroId: APPROVED_REGISTRO_ID, deviceId: DEVICE,
    workdayRecord: {
      cliente_id: TENANT, empleado_id: EMPLOYEE, schedule_id: 'schedule', timezone: 'America/Cancun',
      workday_date: '2026-09-03', first_in: 'a', last_out: 'b', worked_minutes: 1, break_minutes: 2,
      overtime_minutes: 3, late_minutes: 4, early_leave_minutes: 5, status: 'COMPLETE', integrity_hash: 'hash',
    },
  })
  assert.equal(output.mode, 'SHADOW')
  assert.equal(output.CANARY_MODE, 'SHADOW')
  assert.equal(output.persistenceCalled, false)
  assert.equal(Object.hasOwn(output, 'eventCount'), true)
  assert.equal(Object.hasOwn(output, 'raw_payload'), false)
})

test('14. key, token, and biometric fields cannot appear in safe output', () => {
  const outputSource = safeOutput.toString()
  assert.doesNotMatch(outputSource, /serviceRoleKey|token|raw_payload|template|huella|rostro/i)
})

test('15. runner has no incident write path', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /incidencias|IncidentDetector|\.insert\(|\.update\(|\.delete\(/)
})

test('16. baseline and postcheck scripts are read-only and require a per-run snapshot handoff', async () => {
  const [baseline, postcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/33_production_shadow_baseline.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/34_production_shadow_postcheck.sql', import.meta.url), 'utf8'),
  ])
  for (const sql of [baseline, postcheck]) {
    assert.match(sql, /BEGIN TRANSACTION READ ONLY;/)
    assert.match(sql, /ROLLBACK;/)
    assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bupsert_workday_record\b/)
  }
  assert.match(baseline, /legacy_trigger_fingerprint/)
  assert.match(baseline, /baseline_id/)
  assert.match(baseline, /captured_at_utc/)
  assert.match(postcheck, /counts_identical/)
  assert.match(postcheck, /legacy_trigger_identical/)
  assert.match(postcheck, /7f99cef9-4100-48ff-9aaf-68548c80c948/)
  assert.match(postcheck, /PHASE_33_BASELINE_JSON/)
  assert.match(postcheck, /BASELINE_REQUIRED/)
  assert.match(postcheck, /INVALID_BASELINE/)
  assert.doesNotMatch(postcheck, /31::bigint|2::bigint|4cf2a9c9af606713aadb6209886d66af/)
})
