import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate, evolutionPayload, workdayState } from '../helpers/workdayEvolutionDbreal.js'

// Explicit local target only; never falls back to application credentials.
const url = process.env.PHASE2_AUDIT_DATABASE_URL
const mode = process.env.HISTORY_HOTFIX_MODE
test('DBREAL history uniqueness: reproduce before change / H1-H8 after change', { skip: !url && 'Explicit local DBREAL URL required' }, async t => {
  const target = new URL(url)
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname))
  assert.equal(target.port, '54322')
  assert.ok(['reproduce', 'verify'].includes(mode))
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  const tables = ['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox','incidencias','rate_limits_logs']
  const counts = async () => {
    const result = {}
    for (const name of tables) result[name] = (await db.query(`SELECT count(*)::int n FROM public.${name}`)).rows[0].n
    return result
  }
  const before = await counts()
  let fixture
  try {
    await db.query('BEGIN')
    fixture = await createWorkdayEvolutionFixture(db)
    await enableFixturePersistGate(db, fixture.tenantA.id)
    const call = async payload => {
      const fields = ['cliente_id','empleado_id','workday_date','schedule_id','timezone','first_in','last_out','worked_minutes','break_minutes','overtime_minutes','late_minutes','early_leave_minutes','status','integrity_hash','calculation_version','registro_id','source_observed_at','source_event_count']
      return (await db.query(`SELECT * FROM public.upsert_workday_record(${fields.map((_, i) => '$' + (i + 1)).join(',')})`, fields.map(key => payload[key]))).rows[0]
    }
    let latest
    const advance = async (count, hash) => {
      const timestamp = `2030-06-10T14:0${count - 1}:00.000Z`
      const registro = await createCanonicalRegistro(db, fixture, { occurredAt: timestamp })
      const payload = evolutionPayload(fixture, registro.id, { source_observed_at: timestamp, source_event_count: count, integrity_hash: hash })
      const result = await call(payload)
      latest = payload
      return result
    }
    const state = () => workdayState(db, fixture)
    if (mode === 'reproduce') {
      assert.equal((await advance(1, 'a'.repeat(64))).persistence_result, 'INSERTED')
      assert.equal((await advance(2, 'a'.repeat(64))).persistence_result, 'UPDATED')
      const unchanged = await state()
      await db.query('SAVEPOINT reproduce')
      await assert.rejects(() => advance(3, 'a'.repeat(64)), e => e.code === '23505' && e.constraint === 'workday_record_history_identity_key')
      await db.query('ROLLBACK TO SAVEPOINT reproduce')
      assert.deepEqual(await state(), unchanged, 'failed history insert rolls back projection too')
      console.log('HISTORY_BUG_REPRODUCED=YES ROOT_CAUSE=workday_record_history_identity_key')
      return
    }
    await t.test('H1 INSERTED: one history', async () => { assert.equal((await advance(1, 'a'.repeat(64))).persistence_result, 'INSERTED'); assert.equal((await state()).history_count, 1) })
    await t.test('H2 UPDATED new hash', async () => { assert.equal((await advance(2, 'b'.repeat(64))).persistence_result, 'UPDATED'); assert.equal((await state()).history_count, 2) })
    await t.test('H3 UPDATED same hash', async () => { assert.equal((await advance(3, 'b'.repeat(64))).persistence_result, 'UPDATED'); assert.equal((await state()).history_count, 3) })
    await t.test('H4 repeated UPDATED same hash', async () => {
      assert.equal((await advance(4, 'b'.repeat(64))).persistence_result, 'UPDATED')
      assert.equal((await state()).history_count, 4)
      const rows = (await db.query("SELECT id,source_event_count,source_observed_at FROM public.workday_record_history WHERE workday_record_id=$1 AND integrity_hash=$2 AND action='UPDATED' ORDER BY source_event_count", [(await state()).id, 'b'.repeat(64)])).rows
      assert.deepEqual(rows.map(r => r.source_event_count), [2,3,4])
      assert.equal(new Set(rows.map(r => r.id)).size, 3)
      assert.equal(new Set(rows.map(r => r.source_observed_at.toISOString())).size, 3)
    })
    await t.test('H5 exact replay UNCHANGED', async () => { const prev = await state(); assert.equal((await call(latest)).persistence_result, 'UNCHANGED'); assert.deepEqual(await state(), prev) })
    await t.test('H6 STALE no mutation', async () => { const prev = await state(); assert.equal((await call({ ...latest, source_event_count: 3, source_observed_at: '2030-06-10T14:02:00.000Z' })).persistence_result, 'STALE'); assert.deepEqual(await state(), prev) })
    await t.test('H7 snapshot conflict no mutation', async () => {
      const prev = await state(); await db.query('SAVEPOINT conflict')
      await assert.rejects(() => call({ ...latest, worked_minutes: 1 }), e => e.message === 'PERSIST_SNAPSHOT_CONFLICT')
      await db.query('ROLLBACK TO SAVEPOINT conflict'); assert.deepEqual(await state(), prev)
    })
    await t.test('H8 error after projection update: zero partial history/projection', async () => {
      const prev = await state(); await db.query('SAVEPOINT atomicity')
      // Fail the history INSERT after the RPC UPDATE has executed.
      await db.query("CREATE FUNCTION pg_temp.reject_hotfix_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'HOTFIX_INJECTED_HISTORY_FAILURE'; END $$")
      await db.query('CREATE TRIGGER hotfix_history_failure BEFORE INSERT ON public.workday_record_history FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_hotfix_history()')
      await assert.rejects(() => advance(5, 'b'.repeat(64)), e => e.message === 'HOTFIX_INJECTED_HISTORY_FAILURE')
      await db.query('ROLLBACK TO SAVEPOINT atomicity'); assert.deepEqual(await state(), prev)
    })
  } finally {
    try {
      await db.query('ROLLBACK')
      assert.deepEqual(await counts(), before, 'all fixture and trigger side-effect counts restored')
      if (fixture) assert.equal((await db.query('SELECT count(*)::int n FROM public.clientes WHERE id=ANY($1::uuid[])', [[fixture.tenantA.id, fixture.tenantB.id]])).rows[0].n, 0)
      console.log('DBREAL_CLEAN=YES')
    } finally { await db.end() }
  }
})
