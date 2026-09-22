import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { workdayEvolutionDbrealConfig, createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate } from '../helpers/workdayEvolutionDbreal.js'

const read = name => readFileSync(new URL(`../../database/live-schema/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const original = read('15_source_event_link_rpc.sql').match(/CREATE FUNCTION public\.link_attendance_source_event\([\s\S]*?\$function\$;/)[0]
const migration = read('99_link_attendance_source_event_order_fix.sql')
const fixed = migration.match(/CREATE OR REPLACE FUNCTION public\.link_attendance_source_event\([\s\S]*?\$function\$;/)[0]
const outbox = read('92_productive_persist_outbox_contract_change.sql')
const trigger = outbox.match(/CREATE FUNCTION public\.enqueue_attendance_persist_outbox\(\)[\s\S]*?END \$fn\$;/)[0]

test('99 preserves the entire original function except write ordering and deferring the link write until validation completes', () => {
  const start = original.indexOf('  UPDATE public.attendance_source_events e')
  const end = original.indexOf('  RETURN QUERY', start)
  const processed = original.slice(start, end)
  const write = '    UPDATE public.registro_asistencia r\n    SET source_event_id = p_source_event_id\n    WHERE r.id = v_registro_id;\n\n'
  // Reverse only the allowed move, then compare every validation, lock,
  // declaration, error, return value, and final confirmation byte-for-byte.
  let restored = fixed.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
    .replace(processed, '')
    .replace('  IF v_registro_source_event_id IS NULL THEN\n' + write.trimEnd() + '\n  END IF;\n\n', '')
    .replace('  IF v_registro_source_event_id IS NULL THEN\n', '  IF v_registro_source_event_id IS NULL THEN\n' + write)
    .replace('  RETURN QUERY', processed + '  RETURN QUERY')
  assert.equal(restored, original)
  assert.ok(fixed.indexOf("MESSAGE = 'registro_asistencia ya pertenece a otro source event'") < fixed.indexOf(processed))
  assert.ok(fixed.indexOf(processed) < fixed.indexOf('UPDATE public.registro_asistencia'))
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE)\s/i)
})

// Use the existing guarded localhost Supabase schema, with all fixture writes
// and temporary function replacements inside a transaction that is rolled back.
const config = workdayEvolutionDbrealConfig()
test('PostgreSQL A-D: actual linking RPC and phase-92 trigger, replay, rejection and rollback', {
  skip: !config.ready && config.skipReason,
}, async t => {
  const client = new pg.Client({ connectionString: config.dbUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    const installed = await client.query("SELECT pg_get_functiondef('public.link_attendance_source_event(uuid)'::regprocedure) AS definition")
    assert.ok(installed.rows[0].definition.indexOf('UPDATE public.attendance_source_events') < installed.rows[0].definition.indexOf('UPDATE public.registro_asistencia'), 'Phase 99 must be installed locally before this suite')
    const binding = await client.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='public.registro_asistencia'::regclass AND tgname='trg_enqueue_attendance_persist_outbox' AND tgenabled='O'")
    assert.equal(binding.rowCount, 1)
    assert.match(binding.rows[0].definition, /AFTER INSERT OR UPDATE OF source_event_id/)
    const installedTrigger = await client.query("SELECT prosrc FROM pg_proc WHERE oid='public.enqueue_attendance_persist_outbox()'::regprocedure")
    assert.equal(installedTrigger.rows[0].prosrc.replace(/\r\n/g, '\n').trim(), trigger.split('$fn$')[1].trim())
    const fixture = await createWorkdayEvolutionFixture(client)
    const record = await createCanonicalRegistro(client, fixture, { occurredAt: '2030-06-10T14:00:00.000Z' })
    const registro = record.id
    const event = (await client.query('SELECT source_event_id FROM public.registro_asistencia WHERE id=$1', [registro])).rows[0].source_event_id
    assert.ok(event)
    await client.query('UPDATE public.registro_asistencia SET source_event_id=NULL WHERE id=$1', [registro])
    await client.query("UPDATE public.attendance_source_events SET processing_status='PENDING',processing_error='previous error' WHERE id=$1", [event])
    await enableFixturePersistGate(client, fixture.tenantA.id)
    const call = () => client.query('SELECT * FROM public.link_attendance_source_event($1)', [event])
    const state = async () => (await client.query(
      'SELECT e.processing_status,e.processing_error,r.source_event_id,(SELECT count(*)::int FROM public.attendance_persist_outbox WHERE registro_id=$2) AS outbox_count,(SELECT status FROM public.attendance_persist_outbox WHERE registro_id=$2) AS outbox_status FROM public.attendance_source_events e CROSS JOIN public.registro_asistencia r WHERE e.id=$1 AND r.id=$2', [event, registro])).rows[0]
    await t.test('D control: original function reproduces canonical-source failure', async () => {
      await client.query('SAVEPOINT old_bug')
      await client.query(original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
      await assert.rejects(call, { code: '23514', message: 'PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID' })
      await client.query('ROLLBACK TO SAVEPOINT old_bug')
      assert.deepEqual(await state(), { processing_status: 'PENDING', processing_error: 'previous error', source_event_id: null, outbox_count: 0, outbox_status: null })
    })
    await client.query(fixed)
    await client.query(fixed)
    await t.test('A/D: PENDING source becomes PROCESSED and links with a PENDING outbox', async () => {
      assert.deepEqual((await call()).rows, [{ source_event_id: event, registro_id: registro, link_result: 'LINKED' }])
      assert.deepEqual(await state(), { processing_status: 'PROCESSED', processing_error: null, source_event_id: event, outbox_count: 1, outbox_status: 'PENDING' })
    })
    await t.test('B: replay returns ALREADY_LINKED without duplicating outbox', async () => {
      assert.equal((await call()).rows[0].link_result, 'ALREADY_LINKED')
      assert.equal((await state()).outbox_count, 1)
    })
    const otherLog = await client.query("INSERT INTO public.attendance_logs(device_serial,user_id,timestamp,status,verify_type,metodo) VALUES($1,$2,'2030-06-10T15:00:00Z','dbreal-canonical-source',1,'huella') RETURNING id", [fixture.deviceA.serial_number, 'phase99-unmatched-' + fixture.suffix])
    for (const [table, column, value, code, message] of [
      ['attendance_source_events', 'source_type', 'API', '22023', 'el source event no es de tipo ZKTECO'],
      ['registro_asistencia', 'cliente_id', fixture.tenantB.id, '23514', 'Empresa distinta entre source event y registro_asistencia'],
      ['registro_asistencia', 'empleado_id', fixture.employeeB.id, '23514', 'colaborador distinto entre source event y registro_asistencia'],
      ['registro_asistencia', 'dispositivo_id', fixture.deviceB.id, '23514', 'dispositivo distinto entre source event y registro_asistencia'],
      ['attendance_source_events', 'source_reference', otherLog.rows[0].id, 'P0003', 'source_reference debe resolver exactamente un registro_asistencia'],
    ]) {
      await t.test('C: ' + column + ' rejection matches original function and leaves no writes', async () => {
        for (const fn of [original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'), fixed]) {
          await client.query('SAVEPOINT invalid_case')
          await client.query(fn)
          await client.query('DELETE FROM public.attendance_persist_outbox WHERE registro_id=$1', [registro])
          await client.query('UPDATE public.registro_asistencia SET source_event_id=NULL WHERE id=$1', [registro])
          await client.query("UPDATE public.attendance_source_events SET processing_status='PENDING', processing_error='previous error' WHERE id=$1", [event])
          await client.query('UPDATE public.' + table + ' SET ' + column + '=$1 WHERE id=$2', [value, table === 'registro_asistencia' ? registro : event])
          const before = await state()
          await client.query('SAVEPOINT invoke_invalid')
          await assert.rejects(call, { code, message })
          await client.query('ROLLBACK TO SAVEPOINT invoke_invalid')
          assert.deepEqual(await state(), before)
          await client.query('ROLLBACK TO SAVEPOINT invalid_case')
        }
      })
    }
    await t.test('outbox insert failure rolls back PROCESSED, link and partial outbox', async () => {
      await client.query('DELETE FROM public.attendance_persist_outbox WHERE registro_id=$1', [registro])
      await client.query('UPDATE public.registro_asistencia SET source_event_id=NULL WHERE id=$1', [registro])
      await client.query("UPDATE public.attendance_source_events SET processing_status='PENDING',processing_error='previous error' WHERE id=$1", [event])
      // Fault AFTER the real outbox INSERT: prove the source was PROCESSED and
      // the link/outbox visible inside the transaction before raising an error.
      await client.query(`CREATE FUNCTION public.phase99_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM public.attendance_source_events e JOIN public.registro_asistencia r ON r.source_event_id=e.id WHERE e.id=NEW.source_event_id AND e.processing_status='PROCESSED' AND r.id=NEW.registro_id)
             OR NOT EXISTS(SELECT 1 FROM public.attendance_persist_outbox WHERE id=NEW.id)
          THEN RAISE EXCEPTION 'PHASE99_FAULT_PRECONDITION_FAILED'; END IF;
          RAISE EXCEPTION 'PHASE99_TEST_OUTBOX_INSERT_FAILURE';
        END $fault$;
        CREATE TRIGGER phase99_test_outbox_failure AFTER INSERT ON public.attendance_persist_outbox FOR EACH ROW EXECUTE FUNCTION public.phase99_test_outbox_failure();`)
      const before = await state()
      await client.query('SAVEPOINT trigger_failure')
      await assert.rejects(call, { code: 'P0001', message: 'PHASE99_TEST_OUTBOX_INSERT_FAILURE' })
      await client.query('ROLLBACK TO SAVEPOINT trigger_failure')
      assert.deepEqual(await state(), before)
      assert.deepEqual(before, { processing_status: 'PENDING', processing_error: 'previous error', source_event_id: null, outbox_count: 0, outbox_status: null })
    })
  } finally {
    try { await client.query('ROLLBACK') } finally { await client.end() }
  }
})
