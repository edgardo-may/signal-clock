import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const {
  BASELINE_MARKER,
  ProductionShadowBaselineError,
  validateBaseline,
  renderPostcheckSql,
} = require('../../backend/scripts/render-production-shadow-postcheck.js')

const TEMPLATE_URL = new URL('../../database/live-schema/34_production_shadow_postcheck.sql', import.meta.url)

function baseline(overrides = {}) {
  return {
    phase: '33_production_shadow_baseline',
    read_only: 'on',
    candidate_registro_id: '7f99cef9-4100-48ff-9aaf-68548c80c948',
    captured_at_utc: '2026-09-08T14:05:06.123Z',
    baseline_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    counts: {
      devices: 11,
      horarios: 12,
      incidencias: 13,
      workday_records: 0,
      empleados_horarios: 14,
      registro_asistencia: 15,
      attendance_source_events: 16,
    },
    legacy_trigger_fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ...overrides,
  }
}

test('1. renderer transports the exact current Phase 33 snapshot into one local Phase 34 copy', async () => {
  const template = await readFile(TEMPLATE_URL, 'utf8')
  const current = baseline()
  const rendered = renderPostcheckSql(template, current)

  assert.equal(rendered.includes(BASELINE_MARKER), false)
  assert.match(rendered, /"registro_asistencia":15/)
  assert.match(rendered, /"attendance_source_events":16/)
  assert.match(rendered, /"baseline_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/)
  assert.doesNotMatch(rendered, /31::bigint|2::bigint/)
})

test('2. invalid or absent baselines fail closed before rendering', async () => {
  const template = await readFile(TEMPLATE_URL, 'utf8')
  assert.throws(
    () => validateBaseline(null),
    (error) => error instanceof ProductionShadowBaselineError && error.code === 'BASELINE_INVALID'
  )
  assert.throws(
    () => renderPostcheckSql(template, baseline({ candidate_registro_id: '00000000-0000-4000-8000-000000000000' })),
    (error) => error instanceof ProductionShadowBaselineError && error.code === 'BASELINE_CANDIDATE_DENIED'
  )
})

test('3. template explicitly preserves real mismatches and legacy fingerprint mismatches as failures', async () => {
  const template = await readFile(TEMPLATE_URL, 'utf8')
  assert.match(template, /'BASELINE_REQUIRED'/)
  assert.match(template, /'INVALID_BASELINE'/)
  assert.match(template, /'MISMATCH'/)
  assert.match(template, /baseline\.counts = current_counts\.value/)
  assert.match(template, /baseline\.legacy_trigger_fingerprint = COALESCE/)
  assert.match(template, /'postcheck_pass'.*counts_identical/s)
})

test('4. baseline and postcheck handoff has no database client, RPC, or write path', async () => {
  const [renderer, template] = await Promise.all([
    readFile(new URL('../../backend/scripts/render-production-shadow-postcheck.js', import.meta.url), 'utf8'),
    readFile(TEMPLATE_URL, 'utf8'),
  ])
  assert.doesNotMatch(renderer, /require\(['"]@supabase|createClient|WorkdayPersistenceService|upsert_workday_record|\.rpc\(/i)
  assert.doesNotMatch(template, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|upsert_workday_record/i)
})
