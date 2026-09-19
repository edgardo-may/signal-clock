import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const contract = require('../../backend/scripts/legacy-persist-authorization-retirement-contract.js')
const { LEGACY_AUTHORIZATION: LEGACY, NEW_CANARY } = contract

function approved(rows = [LEGACY], overrides = {}) {
  return contract.evaluateRetirementPrecheck({ authorizationRows: rows, revisionFeatureMode: 'SHADOW', activeTenantCount: 0, ...overrides })
}

test('65b.1 exact unique legacy row is the only retirement-eligible state', () => {
  assert.deepEqual(approved(), {
    globalCount: 1, exactLegacyCount: 1, newAuthorizationCount: 0,
    revisionFeatureMode: 'SHADOW', activeTenantCount: 0, safeToRetire: true,
  })
})

test('65b.2 zero or multiple authorizations fail closed', () => {
  assert.equal(approved([]).safeToRetire, false)
  assert.equal(approved([LEGACY, { ...LEGACY, cliente_id: 'other' }]).safeToRetire, false)
})

test('65b.3 every legacy identity field is exact', () => {
  for (const [field, value] of Object.entries(LEGACY)) {
    const changed = { ...LEGACY, [field]: typeof value === 'boolean' ? !value : `${value}-wrong` }
    assert.equal(approved([changed]).safeToRetire, false, field)
  }
})

test('65b.4 new authorization, non-SHADOW resolver, or ACTIVE tenant blocks retirement', () => {
  const newAuth = { ...LEGACY, ...NEW_CANARY }
  assert.equal(approved([LEGACY, newAuth]).safeToRetire, false)
  assert.equal(approved([LEGACY], { revisionFeatureMode: 'OFF' }).safeToRetire, false)
  assert.equal(approved([LEGACY], { revisionFeatureMode: 'ACTIVE' }).safeToRetire, false)
  assert.equal(approved([LEGACY], { activeTenantCount: 1 }).safeToRetire, false)
})

test('65b.5 a transaction must affect exactly one authorization row', () => {
  assert.equal(contract.assertSingleRetirementDelete(1), true)
  for (const affectedRows of [-1, 0, 2, undefined]) {
    assert.throws(() => contract.assertSingleRetirementDelete(affectedRows), { code: 'LEGACY_RETIRE_AFFECTED_ROWS_INVALID' })
  }
})

test('65b.6 SQL uses read-only pre/postchecks and the change can delete only the exact tenant_features row', async () => {
  const [precheck, change, postcheck] = await Promise.all([
    readFile(new URL('../../database/live-schema/65b_legacy_persist_authorization_retirement_precheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/65c_legacy_persist_authorization_retirement_change.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../database/live-schema/65d_legacy_persist_authorization_retirement_postcheck.sql', import.meta.url), 'utf8'),
  ])
  assert.match(precheck, /BEGIN TRANSACTION READ ONLY/)
  assert.match(postcheck, /BEGIN TRANSACTION READ ONLY/)
  assert.match(change, /BEGIN ISOLATION LEVEL SERIALIZABLE/)
  assert.match(change, /LOCK TABLE public\.tenant_features/)
  assert.match(change, /DELETE FROM public\.tenant_features/)
  assert.match(change, /GET DIAGNOSTICS v_deleted = ROW_COUNT/)
  assert.match(change, /v_deleted <> 1/)
  assert.doesNotMatch(change, /INSERT INTO public\.tenant_features|UPDATE public\.tenant_features|workday_records\s*(?:SET|\()|workday_record_history\s*(?:SET|\()|registro_asistencia\s*(?:SET|\()|incidencias\s*(?:SET|\()|attendance_source_events\s*(?:SET|\()/i)
  assert.match(precheck, /legacy_workday_rows/)
  assert.match(postcheck, /legacy_business_records_unchanged/)
  assert.match(postcheck, /safe_to_rerun_phase_65/)
  assert.doesNotMatch(postcheck, /NULL::jsonb|PHASE_65B_PRECHECK_JSON/)
  assert.match(postcheck, /d41d8cd98f00b204e9800998ecf8427e/)
})

function postcheckCurrent(overrides = {}) {
  return {
    legacy_authorization_rows: 0, total_authorization_rows: 0, new_authorization_rows: 0,
    revisionFeatureMode: 'SHADOW', activeTenantCount: 0,
    ...contract.APPROVED_RETIRED_BASELINE,
    ...overrides,
  }
}

test('65d.1 approved observed baseline and unchanged state pass', () => {
  assert.deepEqual(contract.evaluateRetirementPostcheck({
    baseline: contract.APPROVED_RETIRED_BASELINE, current: postcheckCurrent(),
  }), { baselineValid: true, businessUnchanged: true, safeToRerunPhase65: true })
})

test('65d.2 changed workday/history count or fingerprint fails closed', () => {
  for (const field of ['legacy_workday_rows', 'legacy_history_rows']) {
    const result = contract.evaluateRetirementPostcheck({ baseline: contract.APPROVED_RETIRED_BASELINE, current: postcheckCurrent({ [field]: 1 }) })
    assert.equal(result.businessUnchanged, false, field)
    assert.equal(result.safeToRerunPhase65, false, field)
  }
  for (const field of ['legacy_workday_fingerprint', 'legacy_history_fingerprint']) {
    const result = contract.evaluateRetirementPostcheck({ baseline: contract.APPROVED_RETIRED_BASELINE, current: postcheckCurrent({ [field]: 'f'.repeat(32) }) })
    assert.equal(result.businessUnchanged, false, field)
    assert.equal(result.safeToRerunPhase65, false, field)
  }
})

test('65d.3 authorization, new authorization, resolver SHADOW, and ACTIVE remain mandatory', () => {
  for (const current of [
    postcheckCurrent({ legacy_authorization_rows: 1 }),
    postcheckCurrent({ total_authorization_rows: 1 }),
    postcheckCurrent({ new_authorization_rows: 1 }),
    postcheckCurrent({ revisionFeatureMode: 'OFF' }),
    postcheckCurrent({ activeTenantCount: 1 }),
  ]) {
    const result = contract.evaluateRetirementPostcheck({ baseline: contract.APPROVED_RETIRED_BASELINE, current })
    assert.equal(result.baselineValid, true)
    assert.equal(result.businessUnchanged, true)
    assert.equal(result.safeToRerunPhase65, false)
  }
})

test('65d.4 incomplete or changed baseline itself is invalid and cannot pass', () => {
  for (const baseline of [null, {}, { ...contract.APPROVED_RETIRED_BASELINE, legacy_workday_rows: 1 }, { ...contract.APPROVED_RETIRED_BASELINE, legacy_history_fingerprint: 'e'.repeat(32) }]) {
    const result = contract.evaluateRetirementPostcheck({ baseline, current: postcheckCurrent() })
    assert.equal(result.baselineValid, false)
    assert.equal(result.businessUnchanged, false)
    assert.equal(result.safeToRerunPhase65, false)
  }
})

function premature(rows = [{ ...LEGACY, ...NEW_CANARY }], overrides = {}) {
  return contract.evaluatePrematureAuthorizationPrecheck({
    authorizationRows: rows, targetWorkdayRows: 0, targetHistoryRows: 0,
    revisionFeatureMode: 'SHADOW', activeTenantCount: 0, ...overrides,
  })
}

test('65e.1 exact premature authorization with no workday/history is retirement-eligible', () => {
  const result = premature()
  assert.equal(result.totalAuthorizationRows, 1)
  assert.equal(result.exactAuthorizationRows, 1)
  assert.equal(result.safeToRetire, true)
})

test('65e.2 workday/history, auth drift or multiple authorizations block retirement', () => {
  assert.equal(premature(undefined, { targetWorkdayRows: 1 }).safeToRetire, false)
  assert.equal(premature(undefined, { targetHistoryRows: 1 }).safeToRetire, false)
  assert.equal(premature([{ ...LEGACY, ...NEW_CANARY, canary_schedule_id: 'wrong' }]).safeToRetire, false)
  assert.equal(premature([{ ...LEGACY, ...NEW_CANARY }, { ...LEGACY, ...NEW_CANARY, cliente_id: 'other' }]).safeToRetire, false)
})

test('65e.3 resolver not SHADOW or an ACTIVE tenant blocks retirement', () => {
  assert.equal(premature(undefined, { revisionFeatureMode: 'OFF' }).safeToRetire, false)
  assert.equal(premature(undefined, { activeTenantCount: 1 }).safeToRetire, false)
})

test('65e.4 SQL is read-only and contains no persistence or DML path', async () => {
  const sql = await readFile(new URL('../../database/live-schema/65e_premature_persist_authorization_precheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
  assert.match(sql, /safe_to_retire_premature_authorization/)
  assert.match(sql, /target_workday_fingerprint/)
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b|upsert_workday_record/i)
})

test('65f.1 exact premature authorization may be deleted only before workday/history exists', () => {
  const result = contract.evaluatePrematureRetirementChange({ authorizationRows: [{ ...LEGACY, ...NEW_CANARY }], targetWorkdayRows: 0, targetHistoryRows: 0, revisionFeatureMode: 'SHADOW', activeTenantCount: 0 })
  assert.equal(result.deleteAllowed, true)
  for (const state of [
    { authorizationRows: [], targetWorkdayRows: 0, targetHistoryRows: 0 },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY }, { ...LEGACY, ...NEW_CANARY, cliente_id: 'other' }], targetWorkdayRows: 0, targetHistoryRows: 0 },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY, canary_registro_id: 'wrong' }], targetWorkdayRows: 0, targetHistoryRows: 0 },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY }], targetWorkdayRows: 1, targetHistoryRows: 0 },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY }], targetWorkdayRows: 0, targetHistoryRows: 1 },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY }], targetWorkdayRows: 0, targetHistoryRows: 0, revisionFeatureMode: 'OFF' },
    { authorizationRows: [{ ...LEGACY, ...NEW_CANARY }], targetWorkdayRows: 0, targetHistoryRows: 0, activeTenantCount: 1 },
  ]) {
    assert.equal(contract.evaluatePrematureRetirementChange({ revisionFeatureMode: 'SHADOW', activeTenantCount: 0, ...state }).deleteAllowed, false)
  }
})

test('65f.2 change locks, revalidates, deletes only tenant_features and requires one affected row', async () => {
  const sql = await readFile(new URL('../../database/live-schema/65f_premature_persist_authorization_retirement_change.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/)
  assert.match(sql, /LOCK TABLE public\.tenant_features IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(sql, /PREMATURE_RETIRE_WORKDAY_ALREADY_EXISTS/)
  assert.match(sql, /PREMATURE_RETIRE_HISTORY_ALREADY_EXISTS/)
  assert.match(sql, /GET DIAGNOSTICS v_deleted = ROW_COUNT/)
  assert.match(sql, /v_deleted <> 1/)
  assert.doesNotMatch(sql, /INSERT INTO public\.tenant_features|UPDATE public\.tenant_features|DELETE FROM public\.(?!tenant_features)|upsert_workday_record/i)
})

test('65g.1 approved zero baseline passes; changed count/fingerprint fails closed', () => {
  const current = { total_authorization_rows: 0, premature_authorization_rows: 0, revisionFeatureMode: 'SHADOW', activeTenantCount: 0, ...contract.APPROVED_PREMATURE_BASELINE }
  assert.deepEqual(contract.evaluatePrematureRetirementPostcheck({ baseline: contract.APPROVED_PREMATURE_BASELINE, current }), { baselineValid: true, businessUnchanged: true, safeToRerunPhase65: true })
  for (const field of Object.keys(contract.APPROVED_PREMATURE_BASELINE)) {
    const value = current[field]
    const changed = { ...current, [field]: typeof value === 'number' ? 1 : 'f'.repeat(32) }
    const result = contract.evaluatePrematureRetirementPostcheck({ baseline: contract.APPROVED_PREMATURE_BASELINE, current: changed })
    assert.equal(result.businessUnchanged, false, field)
    assert.equal(result.safeToRerunPhase65, false, field)
  }
})

test('65g.2 postcheck is read-only and requires authorization removal plus SHADOW', async () => {
  const sql = await readFile(new URL('../../database/live-schema/65g_premature_persist_authorization_retirement_postcheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
  assert.match(sql, /business_records_unchanged/)
  assert.match(sql, /safe_to_rerun_phase_65/)
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b|upsert_workday_record/i)
})
