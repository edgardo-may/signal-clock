/** Phase 31 is fully local: fixture repository, no network, no database. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const { AttendanceEngineOrchestrator } = require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const {
  ShadowCanaryRepository,
  localCanaryFixtures,
  nodeRuntimeCompatible,
  runCanary,
  runLocalShadowCanary,
} = require('../../backend/scripts/run-workday-shadow-canary.js')

function shadowOrchestrator(repository) {
  return new AttendanceEngineOrchestrator({
    repository,
    mode: 'SHADOW',
    domain,
    logger: { info: () => {}, error: () => {} },
  })
}

test('1. normal local SHADOW canary passes with a complete result', async () => {
  const report = await runLocalShadowCanary()
  const normal = report.canaries.find((canary) => canary.canary === 'NORMAL')
  assert.equal(normal.CANARY_MODE, 'SHADOW')
  assert.equal(normal.scheduleId, 'normal-schedule')
  assert.equal(normal.workedMinutes, 540)
  assert.equal(normal.workdayState, 'COMPLETE')
  assert.equal(typeof normal.integrityHash, 'string')
})

test('2. normal deterministic replay passes', async () => {
  const result = await runCanary('NORMAL', localCanaryFixtures().normal)
  assert.equal(result.deterministicReplay, true)
})

test('3. night local SHADOW canary passes', async () => {
  const report = await runLocalShadowCanary()
  const night = report.canaries.find((canary) => canary.canary === 'NIGHT')
  assert.equal(night.workdayState, 'COMPLETE')
  assert.equal(night.workedMinutes, 480)
})

test('4. night shift assigns its workday to the previous local date', async () => {
  const result = await runCanary('NIGHT', localCanaryFixtures().night)
  assert.equal(result.operativeDate, '2026-09-04')
})

test('5. night deterministic replay passes', async () => {
  const result = await runCanary('NIGHT', localCanaryFixtures().night)
  assert.equal(result.deterministicReplay, true)
})

test('6. SHADOW persistence call count and write call count are both zero', async () => {
  const report = await runLocalShadowCanary()
  assert.equal(report.persistenceCallCount, 0)
  assert.equal(report.writeCallCount, 0)
  assert.equal(report.canaries.every((canary) => canary.persistenceCalled === false), true)
})

test('7. cross-tenant device fails closed', async () => {
  const fixture = localCanaryFixtures().normal
  const repository = new ShadowCanaryRepository(fixture)
  repository.loadDevice = async () => ({ id: 'shadow-device', cliente_id: 'other-tenant', timezone: 'America/Cancun' })
  await assert.rejects(() => shadowOrchestrator(repository).run({ registroId: fixture.anchorId }), (error) => error.code === 'TENANT_MISMATCH')
})

test('8. cross-tenant employee fails closed', async () => {
  const fixture = localCanaryFixtures().normal
  const repository = new ShadowCanaryRepository(fixture)
  repository.loadEmployee = async () => ({ id: 'shadow-employee', cliente_id: 'other-tenant' })
  await assert.rejects(() => shadowOrchestrator(repository).run({ registroId: fixture.anchorId }), (error) => error.code === 'TENANT_MISMATCH')
})

test('9. two valid schedules fail closed as AMBIGUOUS_SCHEDULE', async () => {
  const fixture = localCanaryFixtures().normal
  fixture.assignments.push({ ...fixture.assignments[0], id: 'assignment-second', horario_id: 'schedule-second', schedule_revision_id: 'revision-schedule-second' })
  fixture.revisions.push({ ...fixture.revisions[0], id: 'revision-schedule-second', horario_id: 'schedule-second' })
  await assert.rejects(
    () => shadowOrchestrator(new ShadowCanaryRepository(fixture)).run({ registroId: fixture.anchorId }),
    (error) => error.code === 'AMBIGUOUS_SCHEDULE'
  )
})

test('10. unresolved device timezone fails closed', async () => {
  const fixture = localCanaryFixtures().normal
  const repository = new ShadowCanaryRepository(fixture)
  repository.loadDevice = async () => ({ id: 'shadow-device', cliente_id: 'shadow-tenant', timezone: null })
  await assert.rejects(
    () => shadowOrchestrator(repository).run({ registroId: fixture.anchorId }),
    (error) => error.code === 'DEVICE_TIMEZONE_MISSING'
  )
})

test('11. expired schedule assignment is not used and resolves UNSCHEDULED', async () => {
  const fixture = localCanaryFixtures().normal
  fixture.assignments[0].fecha_fin = '2026-09-03'
  const result = await shadowOrchestrator(new ShadowCanaryRepository(fixture)).run({ registroId: fixture.anchorId })
  assert.equal(result.workdayRecord.status, 'UNSCHEDULED')
  assert.equal(result.workdayRecord.schedule_id, null)
})

test('12. repeated event has a deterministic calculation', async () => {
  const fixture = localCanaryFixtures().normal
  fixture.records.splice(1, 0, { ...fixture.records[0], id: 'normal-duplicate' })
  const orchestrator = shadowOrchestrator(new ShadowCanaryRepository(fixture))
  const first = await orchestrator.run({ registroId: fixture.anchorId })
  const second = await orchestrator.run({ registroId: fixture.anchorId })
  assert.equal(first.workdayRecord.integrity_hash, second.workdayRecord.integrity_hash)
  assert.equal(first.workdayRecord.worked_minutes, second.workdayRecord.worked_minutes)
})

test('13. no incident write path exists in harness or SHADOW result', async () => {
  const result = await shadowOrchestrator(new ShadowCanaryRepository(localCanaryFixtures().normal)).run({ registroId: 'normal-out' })
  const source = await readFile(new URL('../../backend/scripts/run-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.deepEqual(result.calculation.incidents, [])
  assert.doesNotMatch(source, /incidencias|IncidentDetector|\.insert\(|\.update\(|\.delete\(/)
})

test('14. deprecated WorkdayStatus is not used by the canary harness', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.equal(source.includes('Workday' + 'Status'), false)
})

test('15. runtime version is compatible with the stated Node 22.6 minimum', () => {
  assert.equal(nodeRuntimeCompatible(process.versions.node), true)
  assert.equal(nodeRuntimeCompatible('22.5.9'), false)
})

test('16. manual canary rejects CLI arguments, including a PERSIST attempt', () => {
  const completed = spawnSync(process.execPath, ['backend/scripts/run-workday-shadow-canary.js', '--mode=PERSIST'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(completed.status, 2)
  assert.match(completed.stderr, /Uso:/)
})

test('17. production candidate precheck is read-only and never selects automatically', async () => {
  const sql = await readFile(new URL('../../database/live-schema/31_production_shadow_candidate_precheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(sql, /ROLLBACK;/)
  assert.match(sql, /valid_schedule_count = 1/)
  assert.match(sql, /has_night_schedule/)
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bupsert_workday_record\b|\bLIMIT\b/)
})
