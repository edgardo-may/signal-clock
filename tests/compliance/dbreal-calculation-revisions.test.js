import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate, evolutionPayload, workdayState } from '../helpers/workdayEvolutionDbreal.js'
import * as domain from '../../src/domain/attendance/index.ts'

const require = createRequire(import.meta.url)
const { evidenceManifest, fingerprint } = require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const { getCalculationEngine } = require('../../backend/services/attendance/CalculationEngineRegistry.js')
const url = process.env.PHASE2_AUDIT_DATABASE_URL

test('Phase B DBREAL immutable calculation revisions — stop on first defect', { skip: !url && 'Explicit local DBREAL URL required' }, async t => {
  assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname))
  assert.equal(new URL(url).port, '54322')
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  const tables = ['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox','incidencias','rate_limits_logs','workday_calculation_revisions','workday_revision_promotions']
  const counts = async () => { const result = {}; for (const table of tables) result[table] = (await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n; return result }
  const baseline = await counts()
  let fixture, current, candidate, initial, record
  let completed = 0
  const step = async (name, fn) => {
    let failure
    await t.test(name, async () => { try { await fn(); completed++ } catch (error) { failure = error; throw error } })
    if (failure) {
      console.log(JSON.stringify({ BUG_FOUND: failure.message, PHASE_B_CASE: name, completed }))
      throw failure
    }
  }
  const rejected = async (operation, code) => {
    await db.query('SAVEPOINT expected_rejection')
    try { await assert.rejects(operation, error => error.message === code || error.code === code) }
    finally { await db.query('ROLLBACK TO SAVEPOINT expected_rejection') }
  }
  const state = () => workdayState(db, fixture)
  const call = async (name, params) => {
    const keys = Object.keys(params)
    await db.query('SET LOCAL ROLE service_role')
    try { return (await db.query(`SELECT * FROM public.${name}(${keys.map((key,i) => key+' => $'+(i+1)).join(',')})`, keys.map(key => params[key]))).rows[0] }
    finally { if (!db._ending) { /* errors are restored by the scenario savepoint */ } }
  }
  const persist = async (payload, manifests = true) => {
    const params = Object.fromEntries(['cliente_id','empleado_id','workday_date','schedule_id','timezone','first_in','last_out','worked_minutes','break_minutes','overtime_minutes','late_minutes','early_leave_minutes','status','integrity_hash','calculation_version','registro_id','source_observed_at','source_event_count'].map(key => ['p_'+key,payload[key]]))
    if (manifests) Object.assign(params, { p_evidence_manifest: payload.evidence_manifest, p_context_manifest: payload.context_manifest })
    return call('upsert_workday_record', params)
  }
  const makeCandidate = async (snapshot, context = record.context_manifest, evidence = record.evidence_manifest) => call('create_workday_revision_candidate', {
    p_cliente_id: fixture.tenantA.id, p_empleado_id: fixture.employee.id, p_workday_date: record.workday_date,
    p_snapshot: snapshot, p_evidence_manifest: evidence, p_context_manifest: context,
    p_source_observed_at: record.source_observed_at, p_source_event_count: record.source_event_count,
  })
  const promote = async (id, pointer = current, hash = fingerprint(record.evidence_manifest), overrides = {}) => call('promote_workday_revision', {
    p_cliente_id: fixture.tenantA.id, p_empleado_id: fixture.employee.id, p_workday_date: record.workday_date,
    p_candidate_revision_id: id, p_expected_current_revision_id: pointer, p_expected_evidence_fingerprint: hash, ...overrides,
  })
  const revisions = () => db.query('SELECT * FROM public.workday_calculation_revisions WHERE cliente_id=$1 ORDER BY created_at,id', [fixture.tenantA.id])
  try {
    await db.query('BEGIN')
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")
    fixture = await createWorkdayEvolutionFixture(db)
    await enableFixturePersistGate(db, fixture.tenantA.id)
    const source = await createCanonicalRegistro(db, fixture, { occurredAt: '2030-06-10T14:00:00.000Z' })
    const events = (await db.query('SELECT * FROM public.registro_asistencia WHERE id=$1', [source.id])).rows
    record = evolutionPayload(fixture, source.id)
    record.evidence_manifest = evidenceManifest(domain, events, fixture.tenantA.id, fixture.employee.id, record.workday_date)
    record.context_manifest = { context_manifest_version: 1, calculation_version: 3, schedule_id: fixture.schedule.id, schedule_revision_id: fixture.revision.id, timezone: 'America/Cancun', scheduled_start: '2030-06-10T14:00:00.000Z', scheduled_end: '2030-06-10T23:00:00.000Z', tolerance_minutes: 10, window_before_minutes: 120, window_after_minutes: 180, window_start_utc: '2030-06-10T12:00:00.000Z', window_end_utc: '2030-06-11T02:00:00.000Z', deduplication: { min_seconds: 60, mode: 'KEEP_FIRST', fixed_window: true }, scheduled_break_minutes: 0, auto_deduct_scheduled_break: false }
    await step('B1 CURRENT initial', async () => {
      assert.equal((await persist(record)).persistence_result, 'INSERTED')
      await db.query('SET CONSTRAINTS ALL IMMEDIATE')
      initial = await state(); current = initial.current_revision_id
      assert.ok(current)
      assert.equal((await revisions()).rowCount, 1)
      assert.equal((await db.query('SELECT evidence_fingerprint FROM public.workday_calculation_revisions WHERE id=$1', [current])).rows[0].evidence_fingerprint, fingerprint(record.evidence_manifest))
    })
    await step('B2 exact replay zero history/revision', async () => { assert.equal((await persist(record)).persistence_result, 'UNCHANGED'); assert.deepEqual(await state(), initial); assert.equal((await revisions()).rowCount, 1) })
    await step('B3 same evidence/context different result', async () => { await rejected(() => persist({ ...record, worked_minutes: 1 }), 'PERSIST_SNAPSHOT_CONFLICT'); assert.deepEqual(await state(), initial) })
    await step('B4 stale evidence', async () => { assert.equal((await persist({ ...record, source_observed_at: '2030-06-10T13:00:00.000Z' })).persistence_result, 'STALE'); assert.deepEqual(await state(), initial) })
    const snapshot = (await db.query('SELECT snapshot FROM public.workday_calculation_revisions WHERE id=$1', [current])).rows[0].snapshot
    const v4snapshot = { ...snapshot, calculation_version: 4, integrity_hash: '4'.repeat(64), worked_minutes: 7 }
    const v4context = { ...record.context_manifest, calculation_version: 4 }
    await step('B5 new semantic version creates candidate', async () => { const result = await makeCandidate(v4snapshot, v4context); assert.equal(result.revision_result, 'CREATED'); candidate = result.revision_id })
    await step('B6 pending candidate never changes projection', async () => { assert.deepEqual(await state(), initial); assert.equal((await makeCandidate(v4snapshot, v4context)).revision_result, 'UNCHANGED') })
    await step('B7 valid explicit promotion preserves both revision rows', async () => {
      const before = (await revisions()).rows
      assert.equal((await promote(candidate)).promotion_result, 'PROMOTED')
      assert.deepEqual((await revisions()).rows, before)
      const projection = await state(); assert.equal(projection.current_revision_id, candidate); assert.equal(projection.calculation_version, 4); assert.equal(projection.worked_minutes, 7)
      assert.equal((await db.query("SELECT count(*)::int n FROM public.workday_revision_promotions WHERE previous_revision_id=$1 AND promoted_revision_id=$2 AND operation='PROMOTION'", [current,candidate])).rows[0].n, 1)
    })
    await step('B8 obsolete expected CURRENT', async () => { const before = await state(); await rejected(() => promote(current), 'PROMOTION_CONFLICT'); assert.deepEqual(await state(), before) })
    current = candidate
    await step('B9 changed expected evidence fingerprint', async () => { await rejected(() => promote(randomUUID(), current, '0'.repeat(64)), 'PROMOTION_CONFLICT') })
    await step('B12 double promotion rejected', async () => { await rejected(() => promote(candidate), 'PROMOTION_CONFLICT') })
    await step('B13 semantic downgrade rejected', async () => { await rejected(() => makeCandidate(snapshot), 'PERSIST_CALCULATION_VERSION_MISMATCH') })
    await step('B17 v3 writer after v4 promotion zero mutation', async () => { const before = await state(); await rejected(() => persist(record, false), 'PERSIST_CALCULATION_VERSION_MISMATCH'); assert.deepEqual(await state(), before) })
    await step('B18 unavailable production v4 no fallback', async () => { assert.throws(() => getCalculationEngine(4), { code: 'CALCULATION_VERSION_UNAVAILABLE' }); assert.equal(getCalculationEngine(3).calculationVersion, 3) })
    await step('B24 revision UPDATE rejected', async () => { await rejected(() => db.query('UPDATE public.workday_calculation_revisions SET integrity_hash=$1 WHERE id=$2', ['changed',candidate]), '42501') })
    await step('B25 revision DELETE rejected', async () => { await rejected(() => db.query('DELETE FROM public.workday_calculation_revisions WHERE id=$1', [candidate]), '42501') })
    await step('B26 promotion audit UPDATE/DELETE rejected', async () => { await rejected(() => db.query('UPDATE public.workday_revision_promotions SET actor=$1 WHERE promoted_revision_id=$2', ['changed',candidate]), '42501'); await rejected(() => db.query('DELETE FROM public.workday_revision_promotions WHERE promoted_revision_id=$1', [candidate]), '42501') })
    // A public invoker helper must enforce the same tenant contract as callers.
    await step('B16 backend helper cannot create cross-tenant revision provenance', async () => {
      await rejected(() => call('store_workday_calculation_revision', {
        p_cliente_id: fixture.tenantB.id, p_empleado_id: fixture.employee.id, p_date: record.workday_date,
        p_version: 4, p_evidence: record.evidence_manifest, p_context: v4context,
        p_snapshot: v4snapshot, p_hash: v4snapshot.integrity_hash,
        p_observed: record.source_observed_at, p_count: record.source_event_count,
      }), 'TENANT_MISMATCH')
    })
  } finally {
    try { await db.query('ROLLBACK'); assert.deepEqual(await counts(), baseline); console.log('DBREAL_CLEAN=YES COMPLETED_CASES='+completed) }
    finally { await db.end() }
  }
})
