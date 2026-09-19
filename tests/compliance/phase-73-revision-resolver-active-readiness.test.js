import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const { ACTIVE_READINESS: E, evaluateActiveReadiness } = require('../../backend/scripts/revision-resolver-active-readiness-contract.js')
const { checkActiveRuntimeReadiness } = require('../../backend/attendance-runtime/active-readiness-runtime-check.js')

function ready(overrides = {}) {
  return {
    featureMode: 'SHADOW', featureEnabled: true, activeTenantCount: 0, persistAuthorizationRows: 0,
    applicableAssignmentCount: 1, ambiguousAssignmentCount: 0, assignmentId: E.assignment_id,
    revisionId: E.revision_id, revisionVersion: 1, revisionHash: E.revision_hash,
    workdayRows: 1, historyRows: 1, workdayId: E.workday_id, workdayHash: E.workday_hash,
    calculationVersion: 3, workdayFingerprint: E.workday_fingerprint, historyFingerprint: E.history_fingerprint,
    rpcFingerprint: E.rpc_fingerprint, liveScheduleFallbackDetected: false,
    runtimeVersion: E.runtime_version, runtimeBuildSha: E.runtime_build_sha, runtimeHealth: true,
    ...overrides,
  }
}

test('73.1 exact SHADOW completed-canary evidence and approved runtime are ready', () => {
  assert.deepEqual(evaluateActiveReadiness(ready()), { databasePass: true, runtimePass: true, activeReadiness: true })
})

test('73.2 every critical database deviation fails closed', () => {
  for (const change of [
    { featureMode: 'OFF' }, { activeTenantCount: 1 }, { persistAuthorizationRows: 1 }, { revisionId: null },
    { revisionHash: 'f'.repeat(64) }, { applicableAssignmentCount: 2 }, { ambiguousAssignmentCount: 1 },
    { workdayRows: 0 }, { historyRows: 0 }, { workdayFingerprint: 'f'.repeat(32) }, { historyFingerprint: 'e'.repeat(32) },
    { calculationVersion: 2 }, { rpcFingerprint: 'd'.repeat(32) }, { liveScheduleFallbackDetected: true },
  ]) {
    const result = evaluateActiveReadiness(ready(change))
    assert.equal(result.databasePass, false)
    assert.equal(result.activeReadiness, false)
  }
})

test('73.3 unexpected runtime version/build or unhealthy runtime fails closed', () => {
  for (const change of [{ runtimeVersion: 'other' }, { runtimeBuildSha: 'f'.repeat(64) }, { runtimeHealth: false }]) {
    const result = evaluateActiveReadiness(ready(change))
    assert.equal(result.databasePass, true)
    assert.equal(result.runtimePass, false)
    assert.equal(result.activeReadiness, false)
  }
})

test('73.4 runtime HTTP check is read-only and requires exact version/build/SHADOW_ONLY', async () => {
  const calls = []
  const fetchImplementation = async (url) => {
    calls.push(url)
    const body = url.endsWith('/health')
      ? { status: 'ok', execution_mode: 'SHADOW_ONLY', runtime_version: E.runtime_version, build_sha: E.runtime_build_sha }
      : { status: 'ok', database: 'reachable' }
    return { ok: true, json: async () => body }
  }
  const report = await checkActiveRuntimeReadiness({ ATTENDANCE_RUNTIME_URL: 'https://runtime.example' }, { fetchImplementation })
  assert.equal(report.runtime_readiness_pass, true)
  assert.equal(report.databaseWrites, 0)
  assert.equal(report.rpcWriteCalls, 0)
  assert.deepEqual(calls.sort(), ['https://runtime.example/health', 'https://runtime.example/ready'])
})

test('73.5 readiness SQL is read-only and avoids live horarios fallback', async () => {
  const [sql, orchestrator] = await Promise.all([
    readFile(new URL('../../database/live-schema/73_revision_resolver_active_readiness_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/services/attendance/AttendanceEngineOrchestrator.js', import.meta.url), 'utf8'),
  ])
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
  assert.match(sql, /ambiguous_historic_assignment_pairs/)
  assert.match(sql, /runtime_live_evidence_required/)
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\b/i)
  assert.match(sql, /to_regprocedure\('public\.upsert_workday_record/)
  const scheduleContext = orchestrator.slice(orchestrator.indexOf('async loadScheduleContext'), orchestrator.indexOf('async loadAttendanceEvents'))
  assert.doesNotMatch(scheduleContext, /from\('horarios'\)/)
})
