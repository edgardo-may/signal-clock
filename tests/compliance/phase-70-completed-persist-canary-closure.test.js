import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const closure = require('../../backend/scripts/completed-persist-canary-closure-contract.js')
const runner = require('../../backend/scripts/run-persist-canary-revision-v3.js')
const { COMPLETED_CANARY: C } = closure

function authorization(overrides = {}) {
  return { cliente_id: C.cliente_id, feature_key: 'WORKDAY_PERSIST_CANARY', mode: 'PERSIST_CANARY', enabled: true, canary_registro_id: C.registro_id, canary_empleado_id: C.empleado_id, canary_schedule_id: C.schedule_id, canary_workday_date: C.workday_date, ...overrides }
}

function workday(overrides = {}) {
  return { id: C.workday_id, cliente_id: C.cliente_id, empleado_id: C.empleado_id, workday_date: C.workday_date, schedule_id: C.schedule_id, integrity_hash: C.integrity_hash, calculation_version: 3, ...overrides }
}

function history(overrides = {}) {
  return { workday_record_id: C.workday_id, cliente_id: C.cliente_id, empleado_id: C.empleado_id, workday_date: C.workday_date, integrity_hash: C.integrity_hash, calculation_version: 3, action: 'INSERTED', ...overrides }
}

function completedPrecheck(overrides = {}) {
  return closure.evaluateCompletedCanaryPrecheck({ authorizationRows: [authorization()], workday: workday(), history: history(), registroXmin: C.registro_xmin, revisionFeatureMode: 'SHADOW', activeTenantCount: 0, ...overrides })
}

test('70.1 exact completed canary satisfies retirement precheck', () => {
  assert.equal(completedPrecheck().safeToRetire, true)
})

test('70.2 missing/multiple/wrong authorization and all immutable evidence drift fail closed', () => {
  const invalid = [
    { authorizationRows: [] }, { authorizationRows: [authorization(), authorization({ cliente_id: 'other' })] },
    { authorizationRows: [authorization({ canary_registro_id: 'wrong' })] }, { workday: null }, { history: null },
    { workday: workday({ integrity_hash: 'f'.repeat(64) }) }, { workday: workday({ id: '00000000-0000-4000-8000-000000000001' }) },
    { workday: workday({ calculation_version: 2 }) }, { registroXmin: '16339' }, { revisionFeatureMode: 'OFF' }, { activeTenantCount: 1 },
  ]
  for (const state of invalid) assert.equal(completedPrecheck(state).safeToRetire, false)
})

test('70.3 DELETE completion requires exactly one affected authorization row', () => {
  assert.equal(closure.assertCompletedCanaryDeleteAffectedRows(1), true)
  for (const count of [0, 2, -1, undefined]) assert.throws(() => closure.assertCompletedCanaryDeleteAffectedRows(count), /COMPLETED_CANARY_RETIRE_AFFECTED_ROWS_INVALID/)
})

test('70.4 postcheck preserves completed evidence fingerprints and rejects drift', () => {
  const current = { totalAuthorizationRows: 0, exactAuthorizationRows: 0, workdayExact: true, historyExact: true, ...closure.COMPLETED_EVIDENCE_BASELINE, registroXmin: C.registro_xmin, revisionFeatureMode: 'SHADOW', activeTenantCount: 0, incidencias: 7, registroAsistencia: 41, attendanceSourceEvents: 12 }
  assert.equal(closure.evaluateCompletedCanaryPostcheck(current), true)
  assert.equal(closure.evaluateCompletedCanaryPostcheck({ ...current, workday_fingerprint: 'f'.repeat(32) }), false)
  assert.equal(closure.evaluateCompletedCanaryPostcheck({ ...current, history_fingerprint: 'e'.repeat(32) }), false)
  assert.equal(closure.evaluateCompletedCanaryPostcheck({ ...current, incidencias: 8 }), false)
})

test('70.5 readJsonStrict with dependencies={} falls back to fs.readFile', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signum-read-json-'))
  const file = path.join(directory, 'evidence.json')
  try {
    await writeFile(file, '{"ok":true}', 'utf8')
    assert.deepEqual(await runner.readJsonStrict(file, {}), { ok: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('70.6 exactTimestamp compares instants rather than timestamp spelling', () => {
  assert.equal(runner.exactTimestamp('2026-09-09T14:07:52+00:00', '2026-09-09T14:07:52.000Z'), true)
  assert.equal(runner.exactTimestamp('2026-09-09T14:07:53+00:00', '2026-09-09T14:07:52.000Z'), false)
})

test('70.7 SQL sequence preserves business tables and uses required locks/read-only boundaries', async () => {
  const [precheck, change, postcheck] = await Promise.all([70, 71, 72].map((phase) => readFile(new URL(`../../database/live-schema/${phase}_${['completed_persist_canary_authorization_precheck','completed_persist_canary_authorization_retirement_change','completed_persist_canary_authorization_retirement_postcheck'][phase - 70]}.sql`, import.meta.url), 'utf8')))
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY/)
  assert.match(change, /BEGIN ISOLATION LEVEL SERIALIZABLE/)
  assert.match(change, /LOCK TABLE public\.tenant_features IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(change, /LOCK TABLE public\.workday_records IN SHARE MODE/)
  assert.match(change, /LOCK TABLE public\.workday_record_history IN SHARE MODE/)
  assert.match(change, /GET DIAGNOSTICS v_deleted = ROW_COUNT/)
  assert.doesNotMatch(change, /INSERT INTO public\.(?:workday_records|workday_record_history)|UPDATE public\.(?:workday_records|workday_record_history)|DELETE FROM public\.(?:workday_records|workday_record_history)|upsert_workday_record/i)
  assert.match(postcheck, /BEGIN TRANSACTION READ ONLY/)
  assert.match(postcheck, /completed_canary_business_evidence_unchanged/)
  assert.match(postcheck, /canary_authorization_closed/)
})
