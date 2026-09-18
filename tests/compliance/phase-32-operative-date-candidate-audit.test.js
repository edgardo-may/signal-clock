/** Phase 32.1 performs static/read-only audit checks only; no real DB calls. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const {
  ProductionShadowGuardError,
  APPROVED_REGISTRO_ID,
  readProductionShadowConfig,
} = require('../../backend/scripts/run-production-workday-shadow-canary.js')

const CANDIDATE = '7f99cef9-4100-48ff-9aaf-68548c80c948'

function environment(overrides = {}) {
  return {
    SUPABASE_URL: 'https://project.example.supabase.co',
    SHADOW_CANARY_ALLOWED_HOST: 'project.example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-secret',
    SHADOW_CANARY_CONFIRMATION: 'I_APPROVE_READ_ONLY_SHADOW',
    SHADOW_CANARY_ENVIRONMENT: 'PRODUCTION_SHADOW',
    ...overrides,
  }
}

test('1. production runner requires every guarded environment value', () => {
  assert.throws(
    () => readProductionShadowConfig(CANDIDATE, {}),
    (error) => error instanceof ProductionShadowGuardError && error.code === 'SHADOW_ENV_MISSING'
  )
})

test('2. production runner rejects a destination host mismatch', () => {
  assert.throws(
    () => readProductionShadowConfig(CANDIDATE, environment({ SHADOW_CANARY_ALLOWED_HOST: 'other.example.supabase.co' })),
    (error) => error.code === 'SHADOW_DESTINATION_DENIED'
  )
})

test('3. production runner requires explicit read-only confirmation', () => {
  assert.throws(
    () => readProductionShadowConfig(CANDIDATE, environment({ SHADOW_CANARY_CONFIRMATION: 'yes' })),
    (error) => error.code === 'SHADOW_CONFIRMATION_DENIED'
  )
})

test('4. destination guard accepts only the reviewed exact target configuration', () => {
  const config = readProductionShadowConfig(CANDIDATE, environment())
  assert.equal(config.host, 'project.example.supabase.co')
  assert.equal(config.registroId, CANDIDATE)
  assert.equal(APPROVED_REGISTRO_ID, CANDIDATE)
})

test('5. production runner rejects CLI arguments including a PERSIST attempt', () => {
  const completed = spawnSync(process.execPath, ['backend/scripts/run-production-workday-shadow-canary.js', '--mode=PERSIST'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
  })
  assert.equal(completed.status, 2)
  assert.match(completed.stderr, /Uso:/)
})

test('6. production runner has no persistence service, upsert RPC, or direct write path', async () => {
  const source = await readFile(new URL('../../backend/scripts/run-production-workday-shadow-canary.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /WorkdayPersistenceService|upsert_workday_record|\.rpc\(|\.insert\(|\.update\(|\.delete\(/)
  assert.match(source, /mode: 'SHADOW'/)
  assert.match(source, /SupabaseAttendanceReadRepository/)
})

test('7. Phase 31 precheck has the over-broad previous-date heuristic but no ShiftMatcher window test', async () => {
  const sql = await readFile(new URL('../../database/live-schema/31_production_shadow_candidate_precheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /\(p\.local_event_date - 1\)/)
  assert.doesNotMatch(sql, /event_in_shiftmatcher_window|scheduled_start_utc|window_start_utc/)
})

test('8. Phase 32.1 post-audit is read-only and exposes exact day configs and windows', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_1_production_shadow_candidate_postaudit.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(sql, /ROLLBACK;/)
  assert.match(sql, /day_config/)
  assert.match(sql, /local_event_time/)
  assert.match(sql, /event_in_shiftmatcher_window/)
  assert.match(sql, /OPERATIVE_DATE_MISMATCH/)
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bupsert_workday_record\b/)
})

test('9. post-audit classifies only a matching current-day normal window as APPROVED_NORMAL', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_1_production_shadow_candidate_postaudit.sql', import.meta.url), 'utf8')
  assert.match(sql, /normal_match_count = 1 THEN 'APPROVED_NORMAL'/)
  assert.match(sql, /night_match_count = 1 THEN 'APPROVED_NIGHT'/)
  assert.match(sql, /previous_non_night_count > 0 AND summary\.matching_window_count = 0 THEN 'OPERATIVE_DATE_MISMATCH'/)
})

test('10. reported physical candidates are targeted for review without automatic selection', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_1_production_shadow_candidate_postaudit.sql', import.meta.url), 'utf8')
  for (const id of [
    'ede89226-c2ef-464b-809d-c571013a8c25',
    '13006bce-63d0-47da-8999-ee5b551c3de0',
    '7f99cef9-4100-48ff-9aaf-68548c80c948',
  ]) assert.match(sql, new RegExp(id))
  assert.doesNotMatch(sql, /\bLIMIT\b/)
})

test('11. Phase 32.2 classifies each candidate relation from its own evidence', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_2_production_shadow_candidate_final.sql', import.meta.url), 'utf8')
  assert.match(sql, /WHEN evidence\.assignment_id IS NULL THEN 'UNSCHEDULED'/)
  assert.match(sql, /WHEN evidence\.schedule_id IS NULL THEN 'INVALID'/)
  assert.match(sql, /candidate_relation = 'EVENT_LOCAL_DATE'[\s\S]*'APPROVED_NORMAL'/)
  assert.match(sql, /candidate_relation = 'PREVIOUS_LOCAL_DATE'[\s\S]*'OPERATIVE_DATE_MISMATCH'/)
  assert.match(sql, /relation_summary/)
  assert.doesNotMatch(sql, /summary\.normal_match_count|summary\.night_match_count/)
})

test('12. Phase 32.2 emits separate detail and consolidated outputs with final identity', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_2_production_shadow_candidate_final.sql', import.meta.url), 'utf8')
  assert.match(sql, /'DETAIL' AS output_kind/)
  assert.match(sql, /'CONSOLIDATED' AS output_kind/)
  assert.match(sql, /approved_candidate_count/)
  assert.match(sql, /final_candidate_status/)
  assert.match(sql, /final_operative_date/)
  assert.match(sql, /final_schedule_id/)
  assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bupsert_workday_record\b/)
})

test('13. Phase 32.2 targets exactly the audited candidates and remains manual', async () => {
  const sql = await readFile(new URL('../../database/live-schema/32_2_production_shadow_candidate_final.sql', import.meta.url), 'utf8')
  for (const id of [
    'ede89226-c2ef-464b-809d-c571013a8c25',
    '13006bce-63d0-47da-8999-ee5b551c3de0',
    '7f99cef9-4100-48ff-9aaf-68548c80c948',
  ]) assert.match(sql, new RegExp(id))
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/)
  assert.match(sql, /ROLLBACK;/)
  assert.doesNotMatch(sql, /\bLIMIT\b/)
})
