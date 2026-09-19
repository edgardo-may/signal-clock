import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const { FINAL_ACTIVE: E, evaluateFinalActiveReadiness } = require('../../backend/scripts/revision-resolver-final-active-contract.js')
const { runtimeSourceSha256 } = require('../../backend/attendance-runtime/postdeploy-readonly-check.js')

function exactState(overrides = {}) {
  return {
    featureMode: 'SHADOW', featureEnabled: true, activeTenantCount: 0, persistAuthorizationRows: 0,
    applicableAssignmentCount: 1, ambiguousAssignmentCount: 0, assignmentId: E.assignment_id,
    revisionId: E.revision_id, revisionVersion: 1, revisionHash: E.revision_hash,
    workdayRows: 1, historyRows: 1, workdayId: E.workday_id, workdayHash: E.workday_hash,
    calculationVersion: 3, workdayFingerprint: E.workday_fingerprint, historyFingerprint: E.history_fingerprint,
    rpcFingerprint: E.rpc_fingerprint, sourceRegistroXmin: E.source_registro_xmin,
    sourceEvidenceIntact: true, liveScheduleFallbackDetected: false,
    runtimeVersion: E.runtime_version, runtimeBuildSha: E.runtime_build_sha, runtimeHealth: true,
    runtimeExecutionMode: 'REVISION_RESOLVER_ACTIVE_CAPABLE_READ_ONLY', activeEndpointAvailable: true, readOnlyGuardsRemainEnabled: true,
    ...overrides,
  }
}

test('75.1 complete evidence plus an explicitly ACTIVE-capable runtime is the only GO shape', () => {
  assert.deepEqual(evaluateFinalActiveReadiness(exactState()), {
    databasePass: true, approvedRuntime: true, activeRuntimeCompatible: true, activeReadiness: true,
  })
})

test('75.2 approved SHADOW_ONLY runtime is blocked even when all database evidence is exact', () => {
  const result = evaluateFinalActiveReadiness(exactState({ runtimeExecutionMode: 'SHADOW_ONLY', activeEndpointAvailable: false }))
  assert.equal(result.databasePass, true)
  assert.equal(result.approvedRuntime, true)
  assert.equal(result.activeRuntimeCompatible, false)
  assert.equal(result.activeReadiness, false)
})

test('75.2b v2 runtime release hash is deterministic and matches the candidate contract', async () => {
  assert.equal(E.runtime_version, 'attendance-runtime-v2')
  assert.equal(await runtimeSourceSha256(), E.runtime_build_sha)
})

test('75.3 every database invariant fails closed', () => {
  for (const change of [
    { featureMode: 'OFF' }, { featureEnabled: false }, { activeTenantCount: 1 }, { persistAuthorizationRows: 1 },
    { applicableAssignmentCount: 2 }, { ambiguousAssignmentCount: 1 }, { revisionId: null }, { revisionVersion: 2 },
    { revisionHash: 'f'.repeat(64) }, { workdayRows: 0 }, { historyRows: 0 }, { workdayId: null },
    { workdayHash: 'f'.repeat(64) }, { calculationVersion: 2 }, { workdayFingerprint: 'f'.repeat(32) },
    { historyFingerprint: 'e'.repeat(32) }, { rpcFingerprint: 'd'.repeat(32) }, { sourceRegistroXmin: '1' },
    { sourceEvidenceIntact: false }, { liveScheduleFallbackDetected: true },
  ]) {
    assert.equal(evaluateFinalActiveReadiness(exactState(change)).activeReadiness, false)
  }
})

test('75.4 candidate runtime source exposes explicit ACTIVE capability without persistence', async () => {
  const [app, service] = await Promise.all([
    readFile(new URL('../../backend/attendance-runtime/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../../backend/attendance-runtime/AttendanceRuntimeService.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /\/internal\/attendance\/active/)
  assert.match(service, /RUNTIME_EXECUTION_MODE/)
  assert.match(service, /executeActive/)
  assert.match(app, /\/internal\/attendance\/shadow/)
  assert.match(service, /executionMode: feature\.mode/)
  assert.match(service, /persistenceMode: READ_ONLY_PERSISTENCE_MODE/)
  assert.doesNotMatch(service, /WorkdayPersistenceService|PERSIST_MODE/)
})

test('75.5 final precheck and postchecks are read-only; blocked change contains no UPDATE', async () => {
  const [precheck, blockedChange, postcheck, rollback, rollbackPostcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/75_revision_resolver_final_active_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/76_revision_resolver_active_change_blocked.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/77_revision_resolver_active_immediate_postcheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/78_revision_resolver_active_rollback.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/79_revision_resolver_active_rollback_postcheck.sql', import.meta.url), 'utf8'),
  ])
  for (const sql of [precheck, postcheck, rollbackPostcheck]) {
    assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\b/i)
  }
  assert.match(precheck, /'active_precheck_pass',false/)
  assert.match(precheck, /ACTIVE_RUNTIME_COMPATIBILITY_NOT_IMPLEMENTED/)
  assert.match(blockedChange, /BEGIN ISOLATION LEVEL SERIALIZABLE/)
  assert.match(blockedChange, /ACTIVE_RUNTIME_COMPATIBILITY_NOT_IMPLEMENTED/)
  assert.doesNotMatch(blockedChange, /\bUPDATE\s+public\.tenant_features\b/i)
  assert.match(rollback, /BEGIN ISOLATION LEVEL SERIALIZABLE/)
  assert.match(rollback, /UPDATE\s+public\.tenant_features/)
  assert.match(rollback, /ACTIVE_ROLLBACK_AFFECTED_ROWS_INVALID/)
})

test('75.6 phase 75 exposes every database predicate and permits legitimate later source activity', async () => {
  const sql = await readFile(new URL('../../database/live-schema/75_revision_resolver_final_active_precheck.sql', import.meta.url), 'utf8')
  for (const check of [
    'canary_registro_exists', 'canary_registro_xmin_match', 'target_workday_count_match',
    'target_history_count_match', 'workday_fingerprint_match', 'history_fingerprint_match',
    'assignment_count_match', 'historic_ambiguity_clear', 'revision_exists', 'revision_version_match',
    'revision_integrity_hash_match', 'revision_feature_shadow', 'active_tenants_zero',
    'persist_authorization_absent', 'rpc_fingerprint_match', 'calculation_version_match',
    'source_activity_policy_pass',
  ]) assert.match(sql, new RegExp(`'${check}'`))
  assert.match(sql, /'failed_database_checks',f\.failed_database_checks/)
  assert.match(sql, /registro_asistencia_count>=41/)
  assert.match(sql, /attendance_source_events_count>=12/)
  assert.doesNotMatch(sql, /registro_asistencia_count=41/)
  assert.doesNotMatch(sql, /attendance_source_events_count=12/)
})
