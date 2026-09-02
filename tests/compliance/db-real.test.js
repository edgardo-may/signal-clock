/**
 * DBREAL is intentionally skipped unless an isolated local/test/staging Supabase
 * target is explicitly armed. No mock is used in any test body.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { WorkdayReprocessService } from '../../src/services/attendance/WorkdayReprocessService.ts'
import { auditConfig, cleanupFixture, createFixture, payload, postgresAdminClient } from '../helpers/testDb.js'

const config = auditConfig()
const skip = config.ready ? false : 'Requires guarded local/test/staging credentials and ALLOW_DESTRUCTIVE_TEST_DB=true.'
let fx

describe('DBREAL — Phase 2 persistence (isolated database only)', { concurrency: false }, () => {
  before(async () => { if (config.ready) fx = await createFixture(config) })
  after(async () => { if (config.ready) await cleanupFixture(fx) })

  const rpc = (client, value) => client.rpc('upsert_workday_record', { payload: value })
  const countFor = async date => {
    const { count, error } = await fx.service.from('workday_records').select('id', { count: 'exact', head: true }).eq('cliente_id', fx.tenantA.id).eq('empleado_id', fx.employeeA1.id).eq('workday_date', date)
    assert.equal(error, null)
    return count
  }
  const reprocess = date => WorkdayReprocessService.processWorkday({
    supabaseClient: fx.service, clienteId: fx.tenantA.id, empleadoId: fx.employeeA1.id, workdayDate: date, changeReason: 'DBREAL'
  })
  const setFeatures = async state => {
    const { error } = await fx.service.from('tenant_features').update({ state }).eq('cliente_id', fx.tenantA.id).in('feature_key', ['attendance_engine_v2', 'electronic_workday_record'])
    assert.equal(error, null)
  }

  test('DBREAL-001 anon RPC is denied by PostgreSQL privileges', { skip }, async () => {
    const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } })
    const result = await rpc(anon, payload(fx))
    assert.ok(result.error, 'anon must receive a database permission error')
  })

  test('DBREAL-002 authenticated RPC is denied by PostgreSQL privileges', { skip }, async () => {
    const authenticated = await fx.login(fx.employeeUserA1)
    const result = await rpc(authenticated, payload(fx))
    assert.ok(result.error, 'authenticated must receive a database permission error')
  })

  test('DBREAL-003 service role creates a canonical record and history v1', { skip }, async () => {
    const result = await rpc(fx.service, payload(fx))
    assert.equal(result.error, null)
    assert.equal(result.data.status, 'CREATED')
    const { data: record, error } = await fx.service.from('workday_records').select('id,current_version').eq('id', result.data.workday_record_id).single()
    assert.equal(error, null)
    assert.equal(record.current_version, 1)
    const { count, error: historyError } = await fx.service.from('workday_record_history').select('id', { count: 'exact', head: true }).eq('workday_record_id', record.id).eq('version', 1)
    assert.equal(historyError, null)
    assert.equal(count, 1)
  })

  test('DBREAL-004 admin tenant RLS isolation', { skip }, async () => {
    const adminA = await fx.login(fx.adminA)
    const adminB = await fx.login(fx.adminB)
    const own = await adminA.from('workday_records').select('id').eq('cliente_id', fx.tenantA.id)
    const foreign = await adminA.from('workday_records').select('id').eq('cliente_id', fx.tenantB.id)
    assert.equal(own.error, null)
    assert.ok(own.data.length >= 1)
    assert.equal(foreign.error, null)
    assert.equal(foreign.data.length, 0)
    const reverse = await adminB.from('workday_records').select('id').eq('cliente_id', fx.tenantA.id)
    assert.equal(reverse.error, null)
    assert.equal(reverse.data.length, 0)
  })

  test('DBREAL-005 employee RLS isolation', { skip }, async () => {
    const employee = await fx.login(fx.employeeUserA1)
    const own = await employee.from('workday_records').select('id').eq('empleado_id', fx.employeeA1.id)
    const colleague = await employee.from('workday_records').select('id').eq('empleado_id', fx.employeeA2.id)
    const foreign = await employee.from('workday_records').select('id').eq('cliente_id', fx.tenantB.id)
    assert.equal(own.error, null)
    assert.ok(own.data.length >= 1)
    assert.equal(colleague.data.length, 0)
    assert.equal(foreign.data.length, 0)
  })

  test('DBREAL-006 JWT metadata tampering does not alter RLS identity', { skip }, async () => {
    const employee = await fx.login(fx.employeeUserA1)
    const update = await employee.auth.updateUser({ data: { cliente_id: fx.tenantB.id, empleado_id: fx.employeeA2.id } })
    assert.equal(update.error, null)
    const afterRefresh = await employee.from('workday_records').select('id').eq('empleado_id', fx.employeeA2.id)
    assert.equal(afterRefresh.error, null)
    assert.equal(afterRefresh.data.length, 0)
  })

  test('DBREAL-007 source log from another tenant is rejected', { skip }, async () => {
    const result = await rpc(fx.service, payload(fx, { cliente_id: fx.tenantB.id, empleado_id: fx.employeeB1.id }))
    assert.ok(result.error)
  })

  test('DBREAL-008 authenticated UPDATE history is explicitly rejected', { skip }, async () => {
    const { data, error } = await fx.service.from('workday_record_history').select('id').limit(1).single()
    assert.equal(error, null)
    const admin = await fx.login(fx.adminA)
    const result = await admin.from('workday_record_history').update({ change_reason: 'tamper' }).eq('id', data.id)
    assert.ok(result.error)
    assert.match(`${result.error.message} ${result.error.details || ''}`, /append-only|forbidden/i)
  })

  test('DBREAL-009 service role DELETE history is explicitly rejected by trigger', { skip }, async () => {
    const { data, error } = await fx.service.from('workday_record_history').select('id').limit(1).single()
    assert.equal(error, null)
    const result = await fx.service.from('workday_record_history').delete().eq('id', data.id)
    assert.ok(result.error)
    assert.match(`${result.error.message} ${result.error.details || ''}`, /append-only|forbidden/i)
  })

  test('DBREAL-010 ten concurrent creates converge to one CREATED and nine UNCHANGED', { skip }, async () => {
    const value = payload(fx, { workday_date: '2026-09-03', integrity_hash: 'same-create-hash' })
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc(fx.service, value)))
    assert.ok(results.every(result => !result.error), JSON.stringify(results.map(result => result.error)))
    assert.equal(results.filter(result => result.data.status === 'CREATED').length, 1)
    assert.equal(results.filter(result => result.data.status === 'UNCHANGED').length, 9)
    const { data, error } = await fx.service.from('workday_records').select('id,current_version').eq('workday_date', '2026-09-03')
    assert.equal(error, null)
    assert.equal(data.length, 1)
    assert.equal(data[0].current_version, 1)
  })

  test('DBREAL-011 ten same-hash reprocesses retain version 1 and one history row', { skip }, async () => {
    const value = payload(fx)
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc(fx.service, value)))
    assert.ok(results.every(result => !result.error && result.data.status === 'UNCHANGED'))
    const { data: record } = await fx.service.from('workday_records').select('id,current_version').eq('workday_date', '2026-09-01').single()
    const { count } = await fx.service.from('workday_record_history').select('id', { count: 'exact', head: true }).eq('workday_record_id', record.id)
    assert.equal(record.current_version, 1)
    assert.equal(count, 1)
  })

  test('DBREAL-012 different-hash concurrency creates a contiguous, unique history', { skip }, async () => {
    const date = '2026-09-04'
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => rpc(fx.service, payload(fx, { workday_date: date, integrity_hash: `hash-${index}` }))))
    assert.ok(results.every(result => !result.error), JSON.stringify(results.map(result => result.error)))
    const { data: record, error } = await fx.service.from('workday_records').select('id,current_version').eq('workday_date', date).single()
    assert.equal(error, null)
    const { data: history, error: historyError } = await fx.service.from('workday_record_history').select('version').eq('workday_record_id', record.id).order('version')
    assert.equal(historyError, null)
    assert.deepEqual(history.map(row => row.version), Array.from({ length: record.current_version }, (_, index) => index + 1))
  })

  test('DBREAL-013 TEST_ONLY history fault rolls back the materialized update', { skip }, async () => {
    const pg = await postgresAdminClient(config)
    const triggerName = `trg_phase2_test_only_fail_history_${fx.suffix}`
    const functionName = `phase2_test_only_fail_history_${fx.suffix}`
    try {
      const { data: beforeRecord, error: beforeError } = await fx.service.from('workday_records').select('id,current_version,integrity_hash').eq('workday_date', '2026-09-01').single()
      assert.equal(beforeError, null)
      const { count: beforeHistory } = await fx.service.from('workday_record_history').select('id', { count: 'exact', head: true }).eq('workday_record_id', beforeRecord.id)
      await pg.query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ONLY history fault'; END; $$`)
      await pg.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.workday_record_history FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`)
      const failed = await rpc(fx.service, payload(fx, { integrity_hash: 'rollback-must-not-persist' }))
      assert.ok(failed.error)
      const { data: afterRecord } = await fx.service.from('workday_records').select('current_version,integrity_hash').eq('id', beforeRecord.id).single()
      const { count: afterHistory } = await fx.service.from('workday_record_history').select('id', { count: 'exact', head: true }).eq('workday_record_id', beforeRecord.id)
      assert.equal(afterRecord.current_version, beforeRecord.current_version)
      assert.equal(afterRecord.integrity_hash, beforeRecord.integrity_hash)
      assert.equal(afterHistory, beforeHistory)
    } finally {
      await pg.query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.workday_record_history`)
      await pg.query(`DROP FUNCTION IF EXISTS public.${functionName}()`)
      await pg.end()
    }
  })

  test('DBREAL-014 UNSCHEDULED is superseded when an assignment is resolved', { skip }, async () => {
    const date = '2026-09-05'
    const old = await rpc(fx.service, payload(fx, { workday_date: date, schedule_assignment_id: null, workday_state: 'UNSCHEDULED', integrity_hash: 'unscheduled-first' }))
    assert.equal(old.error, null)
    const next = await rpc(fx.service, payload(fx, { workday_date: date, integrity_hash: 'assigned-second' }))
    assert.equal(next.error, null)
    const { data, error } = await fx.service.from('workday_records').select('id,record_state,superseded_by').eq('workday_date', date)
    assert.equal(error, null)
    assert.equal(data.filter(row => row.record_state === 'ACTIVE').length, 1)
    const superseded = data.find(row => row.id === old.data.workday_record_id)
    assert.equal(superseded.record_state, 'SUPERSEDED')
    assert.equal(superseded.superseded_by, next.data.workday_record_id)
  })

  test('DBREAL-015 assignment A is superseded by assignment B without deletion', { skip }, async () => {
    const assignmentB = await fx.service.from('empleados_horarios').insert({ cliente_id: fx.tenantA.id, empleado_id: fx.employeeA1.id, horario_id: fx.schedule.id, fecha_inicio: '2027-01-01', activo: true }).select().single()
    assert.equal(assignmentB.error, null)
    const date = '2026-09-06'
    const first = await rpc(fx.service, payload(fx, { workday_date: date, integrity_hash: 'assignment-a' }))
    const second = await rpc(fx.service, payload(fx, { workday_date: date, schedule_assignment_id: assignmentB.data.id, integrity_hash: 'assignment-b' }))
    assert.equal(first.error, null)
    assert.equal(second.error, null)
    const { data } = await fx.service.from('workday_records').select('id,record_state,superseded_by').eq('workday_date', date)
    assert.equal(data.filter(row => row.record_state === 'ACTIVE').length, 1)
    assert.equal(data.find(row => row.id === first.data.workday_record_id).superseded_by, second.data.workday_record_id)
  })

  test('DBREAL-016 night shift consumes only its tenant/employee operational window', { skip }, async () => {
    const insertLog = row => fx.service.from('attendance_logs').insert(row).select().single()
    const base = { cliente_id: fx.tenantA.id, numero_serie: `night-${fx.suffix}`, biometric_user_id: fx.employeeA1.hikvision_device_userid }
    const entry = await insertLog({ ...base, timestamp: '2026-09-02T03:58:00.000Z', in_out_state: 0 }) // 21:58 Merida
    const exit = await insertLog({ ...base, timestamp: '2026-09-02T12:03:00.000Z', in_out_state: 1 }) // 06:03 Merida
    assert.equal(entry.error, null); assert.equal(exit.error, null)
    await insertLog({ ...base, timestamp: '2026-08-31T12:00:00.000Z' })
    await insertLog({ ...base, timestamp: '2026-09-02T20:00:00.000Z' })
    await insertLog({ cliente_id: fx.tenantA.id, numero_serie: `night-other-${fx.suffix}`, biometric_user_id: fx.employeeA2.hikvision_device_userid, timestamp: '2026-09-02T03:58:00.000Z' })
    const result = await reprocess('2026-09-01')
    assert.notEqual(result.status, 'ERROR', result.error)
    const { data: record } = await fx.service.from('workday_records').select('workday_date,workday_state,source_log_ids').eq('workday_date', '2026-09-01').single()
    assert.equal(record.workday_date, '2026-09-01')
    assert.equal(record.workday_state, 'COMPLETE')
    assert.ok(record.source_log_ids.includes(entry.data.id))
    assert.ok(record.source_log_ids.includes(exit.data.id))
  })

  test('DBREAL-017 ambiguous assignments return explicit error and do not persist', { skip }, async () => {
    const secondSchedule = await fx.service.from('horarios').insert({ cliente_id: fx.tenantA.id, nombre: `Ambiguous ${fx.suffix}`, dias_config: fx.schedule.dias_config }).select().single()
    assert.equal(secondSchedule.error, null)
    const secondAssignment = await fx.service.from('empleados_horarios').insert({ cliente_id: fx.tenantA.id, empleado_id: fx.employeeA1.id, horario_id: secondSchedule.data.id, fecha_inicio: '2026-08-01', activo: true }).select().single()
    assert.equal(secondAssignment.error, null)
    const before = await countFor('2026-09-07')
    const result = await reprocess('2026-09-07')
    const after = await countFor('2026-09-07')
    assert.equal(result.status, 'ERROR')
    assert.equal(result.error, 'AMBIGUOUS_SCHEDULE_ASSIGNMENT')
    assert.equal(after, before)
    const deactivate = await fx.service.from('empleados_horarios').update({ activo: false }).eq('id', secondAssignment.data.id)
    assert.equal(deactivate.error, null)
  })

  test('DBREAL-018 OFF blocks calculation and persistence', { skip }, async () => {
    await setFeatures('OFF')
    const before = await countFor('2026-09-08')
    const result = await reprocess('2026-09-08')
    assert.equal(result.status, 'ERROR')
    assert.equal(result.error, 'FEATURE_DISABLED')
    assert.equal(await countFor('2026-09-08'), before)
    await setFeatures('SHADOW')
  })

  test('DBREAL-019 SHADOW calculates and persists without official side effects', { skip }, async () => {
    await setFeatures('SHADOW')
    const beforeAttendance = await fx.service.from('registro_asistencia').select('id', { count: 'exact', head: true }).eq('cliente_id', fx.tenantA.id)
    const result = await reprocess('2026-09-01')
    const afterAttendance = await fx.service.from('registro_asistencia').select('id', { count: 'exact', head: true }).eq('cliente_id', fx.tenantA.id)
    assert.notEqual(result.status, 'ERROR', result.error)
    assert.equal(beforeAttendance.count, afterAttendance.count)
    assert.ok(await countFor('2026-09-01'))
  })

  test('DBREAL-019B ACTIVE persists only; Phase 3 consumers remain untouched', { skip }, async () => {
    await setFeatures('ACTIVE')
    const beforeAttendance = await fx.service.from('registro_asistencia').select('id', { count: 'exact', head: true }).eq('cliente_id', fx.tenantA.id)
    const result = await reprocess('2026-09-01')
    const afterAttendance = await fx.service.from('registro_asistencia').select('id', { count: 'exact', head: true }).eq('cliente_id', fx.tenantA.id)
    assert.notEqual(result.status, 'ERROR', result.error)
    assert.equal(beforeAttendance.count, afterAttendance.count)
    assert.ok(await countFor('2026-09-01'))
    await setFeatures('SHADOW')
  })

  test('DBREAL-020 current materialization and canonical history snapshot agree', { skip }, async () => {
    const { data: record, error } = await fx.service.from('workday_records').select('*').eq('workday_date', '2026-09-01').single()
    assert.equal(error, null)
    const { data: history, error: historyError } = await fx.service.from('workday_record_history').select('snapshot,integrity_hash').eq('workday_record_id', record.id).eq('version', record.current_version).single()
    assert.equal(historyError, null)
    for (const key of ['timezone', 'scheduled_start', 'scheduled_end', 'actual_start', 'actual_end', 'worked_minutes', 'break_minutes', 'effective_minutes', 'workday_state', 'integrity_hash', 'source_log_ids', 'punch_dispositions', 'incidents', 'warnings', 'record_state', 'superseded_by']) assert.deepEqual(history.snapshot[key], record[key], key)
    assert.equal(history.integrity_hash, record.integrity_hash)
  })

  test('DBREAL-021 cross-tenant employee_user_link is rejected', { skip }, async () => {
    const result = await fx.service.from('employee_user_links').insert({ cliente_id: fx.tenantA.id, empleado_id: fx.employeeB1.id, auth_user_id: fx.adminA.id })
    assert.ok(result.error)
  })

  test('DBREAL-022 a valid employee log outside its declared source window is rejected', { skip }, async () => {
    const result = await rpc(fx.service, payload(fx, { source_window_end_utc: '2026-09-01T21:00:00.000Z' }))
    assert.ok(result.error)
  })
})
