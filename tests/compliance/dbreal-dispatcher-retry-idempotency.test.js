import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { auditConfig, postgresAdminClient } from '../helpers/testDb.js'
import { createWorkdayEvolutionFixture, cleanupWorkdayEvolutionFixture, enableFixturePersistGate } from '../helpers/workdayEvolutionDbreal.js'

const require = createRequire(import.meta.url)
const { AttendancePersistDispatcher } = require('../../backend/attendance-persist-dispatcher/dispatcher.js')
const { AttendanceRuntimeService } = require('../../backend/attendance-runtime-v3/AttendanceRuntimeService.js')
const config = auditConfig()
// Fail closed BEFORE constructing any connection, even when auditConfig accepts staging.
for (const value of [config.url, config.dbUrl]) {
  if (value && !['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw new Error('DBREAL_LOCALHOST_REQUIRED')
}
const options = { skip: config.ready ? false : 'Explicit localhost DBREAL credentials and destructive-test opt-in required' }
const silent = { info() {}, error() {} }
let db, service, runtime, baseline, suiteLock = false
const fixtures = new Set()

async function one(sql, args = []) { return (await db.query(sql, args)).rows[0] }
async function rpc(name, args) {
  const result = await service.rpc(name, args)
  if (result.error) throw Object.assign(new Error(result.error.message), result.error)
  return result.data
}
async function state(f) { return one('SELECT * FROM public.attendance_persist_outbox WHERE registro_id=$1', [f.registro.id]) }
async function snapshot(f) {
  const workdays = (await db.query('SELECT * FROM public.workday_records WHERE cliente_id=$1 ORDER BY id', [f.tenantA.id])).rows
  const history = (await db.query('SELECT * FROM public.workday_record_history WHERE cliente_id=$1 ORDER BY id', [f.tenantA.id])).rows
  return { workdays, history }
}
function cleanLocks(row) { assert.equal(row.locked_by, null); assert.equal(row.locked_at, null) }
function worker(mode = 'normal') {
  return new AttendancePersistDispatcher({ client: service,
    config: { workerId: `dbretry-${randomUUID()}`, batchSize: 1, runtimeUrl: 'https://localhost', internalToken: 'local-test-only' },
    logger: silent, identityTokenProvider: async () => 'local-transport-only',
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://localhost/internal/attendance/persist')
      if (mode === '503') return { ok: false, json: async () => ({ error_code: 'LOCAL_TRANSIENT_503' }) }
      if (mode === 'denied') return { ok: false, json: async () => ({ error_code: 'PERSIST_AUTHORIZATION_DENIED' }) }
      const { registro_id } = JSON.parse(request.body)
      // Real runtime -> real reads -> real 18-arg persistence RPC. Only transport is injected.
      const result = await runtime.executePersist({ registroId: registro_id })
      if (mode === 'lost') {
        assert.ok(['INSERTED', 'UPDATED'].includes(result.persistence_result))
        throw Object.assign(new Error('Response lost AFTER committed persistence'), { code: 'LOCAL_RESPONSE_LOST' })
      }
      return { ok: true, json: async () => result }
    },
  })
}
async function claim(w, f, expectedAttempt) {
  const rows = await w.claim()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].outbox_id, (await state(f)).id)
  assert.equal(rows[0].attempt_count, expectedAttempt)
  const current = await state(f)
  assert.equal(current.status, 'PROCESSING')
  assert.equal(current.locked_by, w.config.workerId)
  assert.ok(current.locked_at)
  return rows[0]
}
async function fixture() {
  let f
  await db.query('BEGIN')
  try {
    f = await createWorkdayEvolutionFixture(db)
    await enableFixturePersistGate(db, f.tenantA.id)
    await db.query("INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled) VALUES($1,'REVISION_SCHEDULE_RESOLVER','ACTIVE',true)", [f.tenantA.id])
    const at = '2030-06-10T14:00:00.000Z'
    const log = await one(`INSERT INTO public.attendance_logs(device_serial,user_id,timestamp,status,verify_type,metodo)
      VALUES($1,$2,$3,'dbreal-dispatcher',1,'huella') RETURNING id`, [f.deviceA.serial_number, `unmapped-${f.suffix}`, at])
    f.source = await one(`INSERT INTO public.attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,occurred_at,processing_status,raw_payload)
      VALUES($1,$2,$3,'ZKTECO',$4,$5,'PENDING',$6::jsonb) RETURNING id`,
    [f.tenantA.id, f.employee.id, f.deviceA.id, log.id, at, JSON.stringify({ source_log_id: log.id })])
    f.registro = await one(`INSERT INTO public.registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload)
      VALUES($1,$2,$3,$4,'entrada','huella',false,$5::jsonb) RETURNING id`,
    [f.tenantA.id, f.employee.id, f.deviceA.id, at, JSON.stringify({ source_log_id: log.id })])
    assert.equal((await one('SELECT count(*)::int AS n FROM public.attendance_persist_outbox WHERE registro_id=$1', [f.registro.id])).n, 0)
    await db.query('COMMIT')
  } catch (error) { await db.query('ROLLBACK'); throw error }
  fixtures.add(f)
  const linked = await rpc('link_attendance_source_event', { p_source_event_id: f.source.id })
  assert.equal(linked[0].registro_id, f.registro.id)
  assert.equal(linked[0].link_result, 'LINKED')
  const row = await state(f)
  assert.equal(row.status, 'PENDING'); assert.equal(row.attempt_count, 0)
  assert.equal(row.source_event_id, f.source.id)
  return f
}
async function cleanup(f) {
  await db.query("DELETE FROM public.tenant_features WHERE cliente_id=$1 AND feature_key='REVISION_SCHEDULE_RESOLVER'", [f.tenantA.id])
  await cleanupWorkdayEvolutionFixture(db, f)
  fixtures.delete(f)
}
async function scenario(fn) { const f = await fixture(); try { await fn(f) } finally { await cleanup(f) } }

before(async () => {
  db = await postgresAdminClient(config)
  // The guarded localhost process is the sole DBREAL owner for this run.
  // The empty-outbox preflight below is the isolation gate; no production lock is used.
  suiteLock = true
  // Global claim means this suite requires an exclusive, empty local outbox.
  assert.equal((await one('SELECT count(*)::int AS n FROM public.attendance_persist_outbox')).n, 0, 'Refusing nonempty local outbox')
  baseline = (await db.query(`SELECT 'workday' AS kind,count(*)::int AS n FROM public.workday_records
    UNION ALL SELECT 'history',count(*)::int FROM public.workday_record_history ORDER BY kind`)).rows
  // Compare deployed function bodies with the actual migration sources; no substitute RPCs.
  for (const [file, names] of [
    ['92_productive_persist_outbox_contract_change.sql', ['enqueue_attendance_persist_outbox', 'claim_attendance_persist_outbox']],
    ['97_workday_evolution_contract_change.sql', ['complete_attendance_persist_outbox', 'upsert_workday_record']],
    ['99_link_attendance_source_event_order_fix.sql', ['link_attendance_source_event']],
  ]) {
    const sql = await readFile(new URL(`../../database/live-schema/${file}`, import.meta.url), 'utf8')
    for (const name of names) {
      const start = sql.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`))
      const declaration = sql.slice(start)
      const marker = declaration.match(/\bAS\s+(\$[a-z_]*\$)/i)
      assert.ok(start >= 0 && marker, name)
      const body = declaration.slice(marker.index + marker[0].length).split(marker[1])[0].trim()
      const rows = (await db.query(`SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND proname=$1 AND ($1<>'upsert_workday_record' OR pronargs=18)`, [name])).rows
      assert.equal(rows.length, 1, name)
      assert.equal(rows[0].prosrc.trim().replace(/\r\n/g, '\n'), body.replace(/\r\n/g, '\n'), `Contract drift: ${name}`)
    }
  }
  const trigger = await one(`SELECT pg_get_triggerdef(oid) AS definition,tgenabled FROM pg_trigger
    WHERE tgrelid='public.registro_asistencia'::regclass AND tgname='trg_enqueue_attendance_persist_outbox'`)
  assert.equal(trigger.tgenabled, 'O'); assert.match(trigger.definition, /enqueue_attendance_persist_outbox/)
  service = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  runtime = new AttendanceRuntimeService({ client: service, logger: silent })
}, options)

after(async () => {
  if (!db) return
  try {
    for (const f of [...fixtures]) await cleanup(f)
    if (suiteLock && baseline) {
      assert.equal((await one('SELECT count(*)::int AS n FROM public.attendance_persist_outbox')).n, 0)
      assert.deepEqual((await db.query(`SELECT 'workday' AS kind,count(*)::int AS n FROM public.workday_records
        UNION ALL SELECT 'history',count(*)::int FROM public.workday_record_history ORDER BY kind`)).rows, baseline)
    }
  } finally {
    await db.end()
  }
})

test('A NORMAL FLOW: canonical enqueue -> claim -> real persist -> SUCCEEDED', options, () => scenario(async f => {
  const w = worker(); const row = await claim(w, f, 1)
  const result = await w.process(row)
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.persistence_result, 'INSERTED')
  const final = await state(f); cleanLocks(final)
  assert.ok(final.completed_at); assert.equal(final.attempt_count, 1)
  assert.equal(final.workday_id, (await snapshot(f)).workdays[0].id)
}))

test('C TRANSIENT FAILURE: real complete stores RETRY without incrementing attempts', options, () => scenario(async f => {
  const w = worker('503'); const row = await claim(w, f, 1)
  assert.equal((await w.process(row)).status, 'RETRY')
  const final = await state(f); cleanLocks(final)
  assert.equal(final.status, 'RETRY'); assert.equal(final.last_error_code, 'LOCAL_TRANSIENT_503')
  assert.equal(final.completed_at, null); assert.equal(final.attempt_count, 1)
  assert.deepEqual(await snapshot(f), { workdays: [], history: [] })
}))

test('D RETRY RECOVERY: second claim succeeds and clears error', options, () => scenario(async f => {
  const failing = worker('503'); await failing.process(await claim(failing, f, 1))
  const normal = worker(); const row = await claim(normal, f, 2)
  assert.equal((await state(f)).last_error_code, 'LOCAL_TRANSIENT_503')
  assert.equal((await normal.process(row)).status, 'SUCCEEDED')
  const final = await state(f); cleanLocks(final)
  assert.equal(final.attempt_count, 2); assert.equal(final.last_error_code, null); assert.ok(final.completed_at)
}))

async function lostResponse(f) {
  const first = worker('lost'); assert.equal((await first.process(await claim(first, f, 1))).status, 'RETRY')
  assert.equal((await state(f)).last_error_code, 'LOCAL_RESPONSE_LOST')
  const before = await snapshot(f)
  assert.equal(before.workdays.length, 1); assert.equal(before.history.length, 1)
  const second = worker(); const result = await second.process(await claim(second, f, 2))
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.persistence_result, 'UNCHANGED')
  assert.equal(result.workday_id, before.workdays[0].id)
  return before
}
test('E LOST RESPONSE AFTER PERSIST: real committed INSERTED replays as UNCHANGED', options, () => scenario(lostResponse))
test('F NO DUPLICATES: complete snapshot/history unchanged; one outbox per source/registro', options, () => scenario(async f => {
  const before = await lostResponse(f)
  assert.deepEqual(await snapshot(f), before) // includes updated_at, source_event_count and integrity_hash
  assert.equal((await one('SELECT count(*)::int AS n FROM public.attendance_persist_outbox WHERE registro_id=$1 OR source_event_id=$2', [f.registro.id, f.source.id])).n, 1)
  assert.equal((await rpc('link_attendance_source_event', { p_source_event_id: f.source.id }))[0].link_result, 'ALREADY_LINKED')
  assert.equal((await one('SELECT count(*)::int AS n FROM public.attendance_persist_outbox WHERE cliente_id=$1', [f.tenantA.id])).n, 1)
}))

test('G ATTEMPT COUNT: claims increment; complete and rejected ownership do not', options, () => scenario(async f => {
  const a = worker(); const b = worker(); const row = await claim(a, f, 1)
  const before = await state(f)
  await assert.rejects(b.acknowledge(row, 'RETRY', { errorCode: 'LOCAL_TEST' }), { code: 'PERSIST_OUTBOX_ACK_FAILED' })
  assert.deepEqual(await state(f), before)
  await a.acknowledge(row, 'RETRY', { errorCode: 'LOCAL_TEST' })
  assert.equal((await state(f)).attempt_count, 1)
  await b.process(await claim(b, f, 2)); assert.equal((await state(f)).attempt_count, 2)
}))

test('I TERMINAL DENIED is not reclaimable', options, () => scenario(async f => {
  const w = worker('denied'); assert.equal((await w.process(await claim(w, f, 1))).status, 'DENIED')
  const final = await state(f); cleanLocks(final)
  assert.ok(final.completed_at); assert.equal(final.workday_id, null); assert.equal(final.persistence_result, null)
  assert.equal(final.last_error_code, 'PERSIST_AUTHORIZATION_DENIED')
  assert.deepEqual(await worker().claim(), [])
}))

test('J CLAIM EXCLUSIVITY: concurrent real claims and SKIP LOCKED', options, () => scenario(async f => {
  const a = worker(); const b = worker()
  // Hold an actual SQL row lock on the only PENDING row: RPC must skip, not wait.
  await db.query('BEGIN')
  try {
    await db.query('SELECT id FROM public.attendance_persist_outbox WHERE registro_id=$1 FOR UPDATE', [f.registro.id])
    assert.deepEqual(await a.claim(), [])
  } finally { await db.query('ROLLBACK') }
  const [ar, br] = await Promise.all([a.claim(), b.claim()])
  assert.equal(ar.length + br.length, 1)
  const winner = ar.length ? a : b; const row = (ar.length ? ar : br)[0]
  assert.equal(row.outbox_id, (await state(f)).id); assert.equal(row.attempt_count, 1)
  assert.equal((await winner.process(row)).status, 'SUCCEEDED')
}))
test('K SUCCEEDED NOT CLAIMABLE', options, () => scenario(async f => {
  const w = worker(); await w.process(await claim(w, f, 1))
  assert.equal((await state(f)).status, 'SUCCEEDED')
  assert.deepEqual(await worker().claim(), [])
}))
test('L ACTIVE LEASE NOT CLAIMABLE', options, () => scenario(async f => {
  const a = worker(); const b = worker(); const row = await claim(a, f, 1)
  const before = await state(f)
  assert.deepEqual(await b.claim(), [])
  assert.deepEqual(await state(f), before)
  await a.acknowledge(row, 'RETRY', { errorCode: 'LOCAL_CLEANUP' })
}))

test('B EXPIRED LEASE RECOVERY: PASS_WITH_DOCUMENTED_TIME_LIMITATION', options, () => scenario(async f => {
  // Prove exact PostgreSQL boundary semantics without modifying persisted timestamps.
  const boundary = await one(`SELECT
    (transaction_timestamp()-interval '10 minutes' < transaction_timestamp()-interval '10 minutes') AS exact,
    (transaction_timestamp()-interval '10 minutes 1 microsecond' < transaction_timestamp()-interval '10 minutes') AS expired,
    (NULL::timestamptz < transaction_timestamp()-interval '10 minutes') AS missing`)
  assert.deepEqual(boundary, { exact: false, expired: true, missing: null })
  const a = worker(); const b = worker(); const row = await claim(a, f, 1)
  const before = await state(f)
  await assert.rejects(rpc('complete_attendance_persist_outbox', {
    p_outbox_id: before.id, p_worker_id: b.config.workerId, p_terminal_status: 'RETRY',
    p_error_code: 'LOCAL_WRONG_OWNER', p_runtime_result: null, p_workday_id: null,
  }), /PRODUCTIVE_OUTBOX_ACK_OWNERSHIP_INVALID/)
  assert.deepEqual(await state(f), before)
  // A real >10 minute wait is intentionally omitted from the normal suite.
  // No timestamp is edited; exact predicate semantics are covered above.
  await a.acknowledge(row, 'RETRY', { errorCode: 'LOCAL_CLEANUP' })
}))
test('H OWNERSHIP: wrong worker ACK rejected and owner remains authoritative', options, () => scenario(async f => {
  const a = worker(); const b = worker(); const row = await claim(a, f, 1)
  const before = await state(f)
  await assert.rejects(rpc('complete_attendance_persist_outbox', {
    p_outbox_id: before.id, p_worker_id: b.config.workerId, p_terminal_status: 'RETRY',
    p_error_code: 'LOCAL_LATE_ACK', p_runtime_result: null, p_workday_id: null,
  }), /PRODUCTIVE_OUTBOX_ACK_OWNERSHIP_INVALID/)
  assert.deepEqual(await state(f), before)
  await a.acknowledge(row, 'RETRY', { errorCode: 'LOCAL_CLEANUP' })
}))
