import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { workdayEvolutionDbrealConfig, createWorkdayEvolutionFixture,
  cleanupWorkdayEvolutionFixture, enableFixturePersistGate } from '../helpers/workdayEvolutionDbreal.js'

const read = name => readFileSync(new URL(`../../database/live-schema/${name}`, import.meta.url), 'utf8')
const original = readFileSync(new URL('../fixtures/auto-cycle-original-function.sql', import.meta.url), 'utf8')
const change = read('105_auto_open_cycle_classification_change.sql')
const installedBody = change.split('$function$')[1]
const normalized = value => value.replace(/--[^\n]*/g, '').replace(/\s/g, '')

test('105 preserves identity, explicit mappings, verification and insert contract', () => {
  const old = original.split('$function$')[1]
  const identity = body => body.slice(body.indexOf('    -- 1.'), body.indexOf('    -- Calcular') >= 0
    ? body.indexOf('    -- Calcular') : body.indexOf('    -- 3.'))
  assert.equal(normalized(identity(installedBody)), normalized(identity(old)))
  const explicitAndInsert = body => body.slice(body.indexOf('        -- Mapeo manual'))
  assert.equal(normalized(explicitAndInsert(installedBody)), normalized(explicitAndInsert(old)))
  assert.doesNotMatch(installedBody, /punto_medio|v_fecha_local|empleados_horarios|dias_config|workday_date/)
  assert.ok(installedBody.indexOf('pg_advisory_xact_lock') < installedBody.indexOf('SELECT r.tipo_verificacion'))
})

const config = workdayEvolutionDbrealConfig()
test('AUTO DBREAL: real ATTLOG trigger, 18h cycle and Phase 99', {
  skip: !config.ready && config.skipReason,
  timeout: 120000,
}, async t => {
  const db = new pg.Client({ connectionString: config.dbUrl })
  await db.connect()
  let fixture, originalDefinition, applied = false
  const stamp = (day, time) => `2030-06-${String(day).padStart(2, '0')}T${time}-05:00`
  const metadata = async () => (await db.query(`SELECT proowner,proacl,proconfig,prosecdef,provolatile
    FROM pg_proc WHERE oid='public.fn_sync_attendance_to_registro()'::regprocedure`)).rows[0]
  const rowsDigest = async () => (await db.query(`SELECT
    (SELECT md5(coalesce(string_agg(row_to_json(r)::text, '' ORDER BY id), '')) FROM public.registro_asistencia r) AS registros,
    (SELECT md5(coalesce(string_agg(row_to_json(w)::text, '' ORDER BY id), '')) FROM public.workday_records w) AS workdays,
    (SELECT md5(coalesce(string_agg(row_to_json(h)::text, '' ORDER BY id), '')) FROM public.workday_record_history h) AS history`)).rows[0]
  const punch = async (client, time, status, employee = fixture.employee, device = fixture.deviceA) => {
    const log = (await client.query(`INSERT INTO public.attendance_logs
      (device_serial,user_id,timestamp,status,verify_type,metodo)
      VALUES($1,$2,$3,$4,1,'huella') RETURNING id,status`,
    [device.serial_number, employee.device_userid, time, status])).rows[0]
    const rows = (await client.query(`SELECT * FROM public.registro_asistencia
      WHERE raw_payload->>'source_log_id'=$1`, [log.id])).rows
    assert.equal(rows.length, 1, 'one canonical registro per ATTLOG')
    assert.equal(log.status, status)
    assert.equal(rows[0].raw_payload.raw_status, status)
    return { ...rows[0], log_id: log.id }
  }
  const expect = async (time, raw, direction, employee, device) => {
    const row = await punch(db, time, raw, employee, device)
    assert.equal(row.tipo_verificacion, direction)
    return row
  }
  const scenario = async (name, fn) => t.test(name, async () => {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    try { await fn() } finally { await db.query('ROLLBACK') }
  })
  try {
    // These scripts fail closed on any drift; do not replace the baseline to make tests pass.
    originalDefinition = (await db.query(`SELECT pg_get_functiondef(
      'public.fn_sync_attendance_to_registro()'::regprocedure) AS definition`)).rows[0].definition
    const beforeMetadata = await metadata()
    const beforeRows = await rowsDigest()
    await db.query(read('104_auto_open_cycle_classification_precheck.sql'))
    await db.query(change)
    applied = true
    await db.query(read('106_auto_open_cycle_classification_postcheck.sql'))
    assert.deepEqual(await metadata(), beforeMetadata)
    assert.deepEqual(await rowsDigest(), beforeRows, 'migration never changes historical rows')
    const phase99 = (await db.query(`SELECT prosrc FROM pg_proc
      WHERE oid='public.link_attendance_source_event(uuid)'::regprocedure`)).rows[0].prosrc
    assert.ok(phase99.indexOf('UPDATE public.attendance_source_events') < phase99.indexOf('UPDATE public.registro_asistencia'), 'Phase 99 prerequisite')
    await db.query('BEGIN')
    try { fixture = await createWorkdayEvolutionFixture(db); await db.query('COMMIT') }
    catch (error) { fixture = null; await db.query('ROLLBACK'); throw error }

    await scenario('A no previous event -> entrada', () => expect(stamp(10, '09:00:00'), '255', 'entrada'))
    await scenario('B previous entrada <18h -> salida', async () => {
      await expect(stamp(10, '09:00:00'), '0', 'entrada')
      await expect(stamp(10, '18:00:00'), '255', 'salida')
    })
    await scenario('C previous salida <18h -> entrada', async () => {
      await expect(stamp(10, '03:00:00'), '1', 'salida')
      await expect(stamp(10, '09:00:00'), 'auto', 'entrada')
    })
    await scenario('D 23:00 -> 03:00 crosses midnight', async () => {
      await expect(stamp(10, '23:00:00'), '255', 'entrada')
      await expect(stamp(11, '03:00:00'), '255', 'salida')
    })
    await scenario('E overnight followed by another cycle', async () => {
      await expect(stamp(10, '23:00:00'), '255', 'entrada')
      await expect(stamp(11, '03:00:00'), '255', 'salida')
      await expect(stamp(11, '09:00:00'), '255', 'entrada')
      await expect(stamp(11, '18:00:00'), '255', 'salida')
    })
    await scenario('F older than 18h -> entrada', async () => {
      await expect(stamp(8, '09:00:00'), '0', 'entrada')
      await expect(stamp(10, '09:00:00'), '255', 'entrada')
    })
    await scenario('G breaks do not close a cycle', async () => {
      await expect(stamp(10, '09:00:00'), '0', 'entrada')
      await expect(stamp(10, '12:00:00'), '2', 'descanso_inicio')
      await expect(stamp(10, '13:00:00'), '3', 'descanso_fin')
      await expect(stamp(10, '18:00:00'), '255', 'salida')
    })
    await scenario('H extras do not close a cycle', async () => {
      await expect(stamp(10, '09:00:00'), '0', 'entrada')
      await expect(stamp(10, '12:00:00'), '4', 'inicio_extra')
      await expect(stamp(10, '13:00:00'), '5', 'fin_extra')
      await expect(stamp(10, '18:00:00'), '255', 'salida')
    })
    await scenario('I explicit check_in remains entrada', async () => {
      await expect(stamp(10, '09:00:00'), '0', 'entrada')
      await expect(stamp(10, '10:00:00'), 'check_in', 'entrada')
    })
    await scenario('J explicit check_out remains salida', () => expect(stamp(10, '09:00:00'), 'check_out', 'salida'))
    await scenario('K distinct employees in same tenant', async () => {
      const other = (await db.query(`INSERT INTO public.empleados(cliente_id,device_userid,clave_empleado,nombre,apellido,activo)
        VALUES($1,$2,$2,'AUTO','Other',true) RETURNING id,device_userid`, [fixture.tenantA.id, 'AUTO-'+randomUUID()])).rows[0]
      await expect(stamp(10, '09:00:00'), '0', 'entrada', other)
      await expect(stamp(10, '10:00:00'), '255', 'entrada')
    })
    await scenario('L distinct tenants', async () => {
      await expect(stamp(10, '09:00:00'), '0', 'entrada', fixture.employeeB, fixture.deviceB)
      const row = await expect(stamp(10, '10:00:00'), '255', 'entrada')
      assert.equal(row.cliente_id, fixture.tenantA.id)
    })
    await scenario('N empty RAW from actual VM parser -> DB', async () => {
      const { parseAttendanceLogs } = await import('../../zkteco-push-ta/src/parser.ts')
      await expect(stamp(10, '09:00:00'), '0', 'entrada')
      const [parsed] = parseAttendanceLogs('1\t2030-06-10 18:00:00\t\t1')
      assert.equal(parsed.status, '')
      const row = await expect(parsed.timestamp, parsed.status, 'salida')
      assert.equal(row.raw_payload.auto_resolved, true)
    })
    await scenario('O 255 RAW from actual VM parser -> DB', async () => {
      const { parseAttendanceLogs } = await import('../../zkteco-push-ta/src/parser.ts')
      const [parsed] = parseAttendanceLogs('1\t2030-06-10 23:00:00\t255\t1')
      assert.equal(parsed.status, '255')
      await expect(parsed.timestamp, parsed.status, 'entrada')
    })
    await scenario('P Phase 99 linking/outbox remains atomic and idempotent', async () => {
      await enableFixturePersistGate(db, fixture.tenantA.id)
      const row = await expect(stamp(10, '09:00:00'), '255', 'entrada')
      const source = (await db.query(`INSERT INTO public.attendance_source_events
        (cliente_id,employee_id,device_id,source_type,source_reference,occurred_at,processing_status,raw_payload)
        VALUES($1,$2,$3,'ZKTECO',$4,$5,'PENDING',$6) RETURNING id`,
      [fixture.tenantA.id, fixture.employee.id, fixture.deviceA.id, row.log_id, row.verificado_at,
        { source_log_id: row.log_id, raw_status: '255' }])).rows[0]
      await db.query('SELECT * FROM public.link_attendance_source_event($1)', [source.id])
      const inspect = async () => (await db.query(`SELECT e.processing_status,e.processing_error,
        r.source_event_id,o.id,o.status,o.attempt_count FROM public.attendance_source_events e
        JOIN public.registro_asistencia r ON r.source_event_id=e.id
        JOIN public.attendance_persist_outbox o ON o.registro_id=r.id WHERE e.id=$1`, [source.id])).rows
      const once = await inspect()
      assert.equal(once.length, 1)
      assert.equal(once[0].processing_status, 'PROCESSED')
      assert.equal(once[0].processing_error, null)
      assert.equal(once[0].status, 'PENDING')
      await db.query('SELECT * FROM public.link_attendance_source_event($1)', [source.id])
      assert.deepEqual(await inspect(), once)
    })
    await scenario('18h boundary inclusive; 18h + 1 second excluded', async () => {
      await expect(stamp(10, '00:00:00'), '0', 'entrada')
      await db.query('SAVEPOINT boundary')
      await expect(stamp(10, '18:00:00'), 'auto', 'salida')
      await db.query('ROLLBACK TO SAVEPOINT boundary')
      await expect(stamp(10, '18:00:01'), 'auto', 'entrada')
    })
    await scenario('all AUTO tokens and NULL use cycle rule', async () => {
      for (const token of ['255', '-1', 'auto', 'undefined', '', null, ' AUTO ']) {
        await db.query('SAVEPOINT variant')
        await expect(stamp(10, '09:00:00'), token, 'entrada')
        await expect(stamp(10, '18:00:00'), token, 'salida')
        await db.query('ROLLBACK TO SAVEPOINT variant')
      }
    })
    await scenario('all six explicit numeric/text mappings remain unchanged', async () => {
      const mappings = [['0', 'check_in', 'entrada'], ['1', 'check_out', 'salida'],
        ['2', 'break_out', 'descanso_inicio'], ['3', 'break_in', 'descanso_fin'],
        ['4', 'overtime_in', 'inicio_extra'], ['5', 'overtime_out', 'fin_extra']]
      for (const [numeric, alias, expected] of mappings) {
        await db.query('SAVEPOINT explicit_mapping')
        await expect(stamp(10, '09:00:00'), numeric, expected)
        await expect(stamp(10, '10:00:00'), alias, expected)
        await db.query('ROLLBACK TO SAVEPOINT explicit_mapping')
      }
    })
    await scenario('no assignment required', async () => {
      await db.query('UPDATE public.empleados_horarios SET activo=false WHERE id=$1', [fixture.assignment.id])
      await expect(stamp(10, '23:00:00'), 'auto', 'entrada')
      await expect(stamp(11, '03:00:00'), 'auto', 'salida')
    })
    await scenario('same-time prior rows use deterministic UUID tie-break; equal target excluded', async () => {
      const seed = async (id, type) => db.query(`INSERT INTO public.registro_asistencia
        (id,cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,creado_at,es_manual)
        VALUES($1,$2,$3,$4,$5,$6,'huella',$5,false)`,
      [id, fixture.tenantA.id, fixture.employee.id, fixture.deviceA.id, stamp(10, '09:00:00'), type])
      await seed('00000000-0000-4000-8000-000000000001', 'entrada')
      await seed('00000000-0000-4000-8000-000000000002', 'salida')
      await expect(stamp(10, '10:00:00'), 'auto', 'entrada')
      await assert.rejects(
        punch(db, stamp(10, '09:00:00'), 'auto'),
        { code: '22023', message: 'AUTO_CYCLE_OUT_OF_ORDER' },
      )
    })
    await t.test('snapshot isolation fails closed for AUTO', async () => {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      try { await assert.rejects(punch(db, stamp(10, '09:00:00'), '255'), { code: '40001', message: 'AUTO_CYCLE_REQUIRES_READ_COMMITTED' }) }
      finally { await db.query('ROLLBACK') }
    })
    for (const [name, firstTime, secondTime, expectedSecond, expectedError] of [
      ['M concurrent AUTO waits then sees committed predecessor; locks are scoped', stamp(10, '23:00:00'), stamp(11, '03:00:00'), 'salida', false],
      ['M reverse event-time arrival is rejected explicitly', stamp(13, '03:00:00'), stamp(12, '23:00:00'), null, true],
    ]) await t.test(name, async () => {
      const a = new pg.Client({ connectionString: config.dbUrl })
      const b = new pg.Client({ connectionString: config.dbUrl })
      await a.connect(); await b.connect()
      let pending
      try {
        await a.query('BEGIN ISOLATION LEVEL READ COMMITTED')
        await b.query('BEGIN ISOLATION LEVEL READ COMMITTED')
        await b.query("SET LOCAL statement_timeout='10s'")
        const first = await punch(a, firstTime, '255')
        assert.equal(first.tipo_verificacion, 'entrada')
        const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        pending = punch(b, secondTime, '255').then(value => ({ value }), error => ({ error }))
        let waiting = false
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          waiting = (await db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting", [pid])).rows[0].waiting
          if (waiting) break
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        assert.equal(waiting, true, 'second connection must actually wait for the first')
        // An unrelated tenant can classify while this employee is locked.
        await db.query('BEGIN')
        try {
          await db.query("SET LOCAL statement_timeout='2s'")
          await expect(stamp(10, '23:00:00'), '255', 'entrada', fixture.employeeB, fixture.deviceB)
          const other = (await db.query(`INSERT INTO public.empleados(cliente_id,device_userid,clave_empleado,nombre,apellido,activo)
            VALUES($1,$2,$2,'AUTO','Concurrent Other',true) RETURNING id,device_userid`,
          [fixture.tenantA.id, 'AUTO-'+randomUUID()])).rows[0]
          await expect(stamp(10, '23:00:00'), '255', 'entrada', other)
        } finally { await db.query('ROLLBACK') }
        await a.query('COMMIT')
        const result = await pending
        if (expectedError) {
          assert.equal(result.error?.code, '22023')
          assert.match(result.error?.message || '', /AUTO_CYCLE_OUT_OF_ORDER/)
        } else {
          if (result.error) throw result.error
          assert.equal(result.value.tipo_verificacion, expectedSecond)
        }
        await b.query('COMMIT')
      } finally {
        await a.query('ROLLBACK'); await b.query('ROLLBACK')
        if (pending) await pending
        await a.end(); await b.end()
      }
    })
    await scenario('equal timestamp AUTO is rejected explicitly', async () => {
      const equalTime = '2050-06-10T09:00:00-05:00'
      await expect(equalTime, '255', 'entrada')
      const secondDevice = (await db.query(`INSERT INTO public.devices
        (cliente_id,serial_number,name,timezone,is_active)
        VALUES($1,$2,'AUTO equal second device','America/Cancun',true)
        RETURNING id,serial_number`, [fixture.tenantA.id, 'AUTO-EQUAL-'+randomUUID()])).rows[0]
      await db.query('SAVEPOINT equal_rejection')
      await assert.rejects(
        punch(db, equalTime, '255', fixture.employee, secondDevice),
        { code: '22023', message: 'AUTO_CYCLE_OUT_OF_ORDER' },
      )
      await db.query('ROLLBACK TO SAVEPOINT equal_rejection')
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.registro_asistencia
        WHERE empleado_id=$1 AND verificado_at=$2`, [fixture.employee.id, equalTime])).rows[0].n, 1)
    })
  } finally {
    await db.query('ROLLBACK')
    try { if (fixture) await cleanupWorkdayEvolutionFixture(db, fixture) }
    finally {
      try { if (applied && originalDefinition) await db.query(originalDefinition) }
      finally { await db.end() }
    }
  }
})
