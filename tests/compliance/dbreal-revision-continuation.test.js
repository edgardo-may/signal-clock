import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createRequire } from 'node:module'
import * as domain from '../../src/domain/attendance/index.ts'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate, evolutionPayload, workdayState } from '../helpers/workdayEvolutionDbreal.js'
import { createTestCalculationEngineRegistry, createRevisionReadRepository } from '../helpers/workdayRevisionDbreal.js'

const require=createRequire(import.meta.url)
const { evidenceManifest,fingerprint }=require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const { getCalculationEngine }=require('../../backend/services/attendance/CalculationEngineRegistry.js')
const { WorkdayPersistenceService }=require('../../backend/services/attendance/WorkdayPersistenceService.js')
const { AttendanceEngineOrchestrator }=require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const { engineV4 }=require('../fixtures/calculation-engine-v4.cjs')
const url=process.env.PHASE2_AUDIT_DATABASE_URL

test('Phase B resume B17–B26 against real local PostgreSQL', {skip:!url&&'Explicit local DBREAL URL required'},async t=>{
  assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));assert.equal(new URL(url).port,'54322')
  const db=new pg.Client({connectionString:url});await db.connect()
  const tables=['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox','incidencias','rate_limits_logs','workday_calculation_revisions','workday_revision_promotions']
  const counts=async()=>{const out={};for(const table of tables)out[table]=(await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;return out}
  const before=await counts()
  const step=async(name,fn)=>{let failure;await t.test(name,async()=>{try{await fn()}catch(e){failure=e;throw e}});if(failure){console.log(JSON.stringify({BUG_FOUND:failure.message,PHASE_B_CASE:name}));throw failure}}
  const rpc={rpc:async(name,params)=>{const keys=Object.keys(params);await db.query('SET LOCAL ROLE service_role');try{const data=(await db.query(`SELECT * FROM public.${name}(${keys.map((key,i)=>key+' => $'+(i+1)).join(',')})`,keys.map(key=>params[key]))).rows;await db.query('RESET ROLE');return{data,error:null}}catch(e){return{data:null,error:{message:e.message,details:e.detail,code:e.code}}}}}
  const persist=new WorkdayPersistenceService(rpc)
  const invoke=async(name,params)=>{const result=await rpc.rpc(name,params);if(result.error)throw Object.assign(new Error(result.error.message),result.error);return result.data[0]}
  const reject=async(fn,code)=>{const baseline=await counts();await db.query('SAVEPOINT rejected');try{await assert.rejects(fn,e=>e.message===code||e.code===code)}finally{await db.query('ROLLBACK TO SAVEPOINT rejected')}assert.deepEqual(await counts(),baseline)}
  try{
    await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")
    const f=await createWorkdayEvolutionFixture(db);await enableFixturePersistGate(db,f.tenantA.id)
    const first=await createCanonicalRegistro(db,f,{occurredAt:'2030-06-10T14:00:00.000Z'})
    const context={context_manifest_version:1,calculation_version:3,schedule_id:f.schedule.id,schedule_revision_id:f.revision.id,timezone:'America/Cancun',scheduled_start:'2030-06-10T14:00:00.000Z',scheduled_end:'2030-06-10T23:00:00.000Z',tolerance_minutes:10,window_before_minutes:120,window_after_minutes:180,window_start_utc:'2030-06-10T12:00:00.000Z',window_end_utc:'2030-06-11T02:00:00.000Z',deduplication:{min_seconds:60,mode:'KEEP_FIRST',fixed_window:true},scheduled_break_minutes:0,auto_deduct_scheduled_break:false}
    const load=async()=>(await db.query('SELECT * FROM public.registro_asistencia WHERE cliente_id=$1 AND empleado_id=$2 ORDER BY verificado_at,id',[f.tenantA.id,f.employee.id])).rows
    let record=evolutionPayload(f,first.id)
    record.context_manifest=context;record.evidence_manifest=evidenceManifest(domain,await load(),f.tenantA.id,f.employee.id,record.workday_date)
    await persist.persist(record)
    const state=()=>workdayState(db,f)
    const snapshot=async()=>(await db.query('SELECT snapshot FROM public.workday_calculation_revisions WHERE id=$1',[(await state()).current_revision_id])).rows[0].snapshot
    const candidate=async(snap,ctx=record.context_manifest)=>invoke('create_workday_revision_candidate',{p_cliente_id:f.tenantA.id,p_empleado_id:f.employee.id,p_workday_date:record.workday_date,p_snapshot:snap,p_evidence_manifest:record.evidence_manifest,p_context_manifest:ctx,p_source_observed_at:record.source_observed_at,p_source_event_count:record.source_event_count})
    const promote=async(id,pointer,hash=fingerprint(record.evidence_manifest))=>invoke('promote_workday_revision',{p_cliente_id:f.tenantA.id,p_empleado_id:f.employee.id,p_workday_date:record.workday_date,p_candidate_revision_id:id,p_expected_current_revision_id:pointer,p_expected_evidence_fingerprint:hash})
    const base=await snapshot();const previous=(await state()).current_revision_id
    const seed4=await candidate({...base,calculation_version:4,integrity_hash:'4'.repeat(64)},{...context,calculation_version:4})
    await promote(seed4.revision_id,previous)
    await step('B17 CURRENT v4 rejects writer v3 with expected/received',async()=>{
      await db.query('SAVEPOINT mismatch');const before=await state()
      try{await assert.rejects(()=>persist.persist(record),e=>e.code==='PERSIST_CALCULATION_VERSION_MISMATCH'&&e.expected_version===4&&e.received_version===3)}finally{await db.query('ROLLBACK TO SAVEPOINT mismatch')}
      assert.deepEqual(await state(),before)
    })
    await step('B18 real CURRENT v4 with production registry unavailable',async()=>{
      const repo={
        loadRegistro:async id=>(await db.query('SELECT * FROM public.registro_asistencia WHERE id=$1',[id])).rows[0],
        loadDevice:async({clienteId,deviceId})=>(await db.query('SELECT * FROM public.devices WHERE id=$1 AND cliente_id=$2',[deviceId,clienteId])).rows[0],
        loadEmployee:async({clienteId,empleadoId})=>(await db.query('SELECT * FROM public.empleados WHERE id=$1 AND cliente_id=$2',[empleadoId,clienteId])).rows[0],
        // PostgREST delivers PostgreSQL DATE as YYYY-MM-DD JSON strings, unlike pg's Date parser.
        loadScheduleContext:async()=>({assignments:(await db.query('SELECT id,cliente_id,empleado_id,horario_id,schedule_revision_id,fecha_inicio::text,fecha_fin::text,activo FROM public.empleados_horarios WHERE cliente_id=$1',[f.tenantA.id])).rows,revisions:(await db.query('SELECT * FROM public.schedule_revisions WHERE cliente_id=$1',[f.tenantA.id])).rows}),
        loadCurrentWorkday:async({clienteId,empleadoId,workdayDate})=>(await db.query('SELECT current_revision_id,calculation_version FROM public.workday_records WHERE cliente_id=$1 AND empleado_id=$2 AND workday_date=$3',[clienteId,empleadoId,workdayDate])).rows[0],
      }
      const assignments=(await repo.loadScheduleContext()).assignments
      assert.ok(assignments.every(row=>typeof row.fecha_inicio==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.fecha_inicio)))
      const resolvedVersions=[]
      const before=await counts();const runtime=new AttendanceEngineOrchestrator({repository:repo,domain,logger:{},engineResolver:version=>{resolvedVersions.push(version);return getCalculationEngine(version)}})
      await assert.rejects(()=>runtime.run({registroId:first.id}),{code:'CALCULATION_VERSION_UNAVAILABLE'})
      assert.deepEqual(resolvedVersions,[4])
      assert.deepEqual(await counts(),before)
      assert.notEqual(getCalculationEngine(3),engineV4);assert.throws(()=>getCalculationEngine(4),{code:'CALCULATION_VERSION_UNAVAILABLE'})
    })
    const pendingContext={...context,calculation_version:4,deduplication:{min_seconds:0,mode:'KEEP_FIRST',fixed_window:true}}
    const pending=await candidate(await snapshot(),pendingContext)
    const pendingBefore=(await db.query('SELECT * FROM public.workday_calculation_revisions WHERE id=$1',[pending.revision_id])).rows[0]
    await step('B19 new evidence recalculated with distinct test-only v4 engine',async()=>{
      const source=await createCanonicalRegistro(db,f,{occurredAt:'2030-06-10T23:00:15.000Z'})
      await db.query("UPDATE public.registro_asistencia SET tipo_verificacion='salida' WHERE id=$1",[source.id])
      const rows=await load();const raw=rows.map(r=>({id:r.id,clienteId:r.cliente_id,empleadoId:r.empleado_id,timestamp:r.verificado_at,inOutState:r.tipo_verificacion}))
      const normalized=domain.AttendanceNormalizer.normalize(raw,'America/Cancun',f.tenantA.id,f.employee.id)
      const match=domain.ShiftMatcher.match({id:f.schedule.id,operativeDate:record.workday_date,startTime:'09:00',endTime:'18:00',toleranceMinutes:10,hasBreak:false},normalized.accepted,'America/Cancun')
      const expectedV3WorkedMinutes=Math.round(540.25),expectedV4WorkedMinutes=Math.ceil(540.25)
      assert.notEqual(expectedV3WorkedMinutes,expectedV4WorkedMinutes)
      assert.equal(getCalculationEngine(3).calculate(domain,match,'America/Cancun',{operativeDate:record.workday_date}).workedMinutes,expectedV3WorkedMinutes)
      const before=await state(),registry=createTestCalculationEngineRegistry([engineV4])
      const runtime=new AttendanceEngineOrchestrator({repository:createRevisionReadRepository(db),domain,logger:{},engineResolver:version=>registry.get(version),executionMode:'ACTIVE',persistenceMode:'PERSIST',persistenceService:persist})
      const result=await runtime.run({registroId:source.id})
      assert.deepEqual(registry.requestedVersions,[4]);assert.deepEqual(registry.executedVersions,[4])
      assert.deepEqual(registry.selectedEngines,[engineV4])
      assert.equal(result.calculation.workedMinutes,expectedV4WorkedMinutes)
      assert.equal(result.persistenceResult,'UPDATED');record=result.workdayRecord
      const after=await state()
      assert.equal(after.id,before.id);assert.equal(after.cliente_id,before.cliente_id);assert.equal(after.empleado_id,before.empleado_id)
      assert.equal(after.calculation_version,4);assert.equal(after.worked_minutes,541)
      assert.notEqual(after.current_revision_id,before.current_revision_id)
      assert.equal(after.history_count,before.history_count+1)
      // now() is transaction-stable; UUID order cannot identify the last append.
      const history=(await db.query('SELECT action,public.workday_revision_snapshot(to_jsonb(h)) snapshot FROM public.workday_record_history h WHERE workday_record_id=$1 AND integrity_hash=$2 AND calculation_version=4 AND source_event_count=2 AND source_observed_at=$3',[after.id,after.integrity_hash,record.source_observed_at])).rows
      assert.equal(history.length,1);assert.equal(history[0].action,'UPDATED')
      const revision=(await db.query('SELECT * FROM public.workday_calculation_revisions WHERE id=$1',[after.current_revision_id])).rows[0]
      assert.equal(revision.integrity_hash,result.calculation.integrityHash)
      assert.equal(revision.snapshot.integrity_hash,after.integrity_hash)
      assert.equal(revision.snapshot.worked_minutes,after.worked_minutes)
      assert.deepEqual(history[0].snapshot,revision.snapshot)
      assert.equal((await db.query('SELECT public.workday_revision_snapshot(to_jsonb(w))=$2::jsonb consistent FROM public.workday_records w WHERE id=$1',[after.id,revision.snapshot])).rows[0].consistent,true)
    })
    await step('B20 pending candidate immutable after new evidence',async()=>{
      assert.deepEqual((await db.query('SELECT * FROM public.workday_calculation_revisions WHERE id=$1',[pending.revision_id])).rows[0],pendingBefore)
      const pointer=(await state()).current_revision_id
      await reject(()=>promote(pending.revision_id,pointer), 'PROMOTION_CONFLICT')
    })
    const fresh=await candidate(await snapshot(),pendingContext);const pointer=(await state()).current_revision_id
    await step('B21 factual mutation before promotion revalidated',async()=>{
      await db.query('SAVEPOINT mutation');await db.query("UPDATE public.registro_asistencia SET tipo_verificacion='salida' WHERE id=$1",[first.id])
      await reject(()=>promote(fresh.revision_id,pointer),'PROMOTION_CONFLICT');await db.query('ROLLBACK TO SAVEPOINT mutation')
    })
    await step('B22 inserted event before validation revalidated',async()=>{
      await db.query('SAVEPOINT new_event');await createCanonicalRegistro(db,f,{occurredAt:'2030-06-11T00:00:00.000Z'})
      await reject(()=>promote(fresh.revision_id,pointer),'PROMOTION_CONFLICT');await db.query('ROLLBACK TO SAVEPOINT new_event')
    })
    await step('B23 post-promotion event continued with authorized v4',async()=>{assert.equal((await state()).calculation_version,4);assert.equal((await state()).source_event_count,2);assert.equal((await db.query("SELECT count(*)::int n FROM public.workday_revision_promotions WHERE previous_revision_id=$1 AND operation='EVIDENCE_UPDATE'",[seed4.revision_id])).rows[0].n,1)})
    const revision=(await state()).current_revision_id
    const protectedWrite=async(sql,params)=>{await db.query('SET LOCAL ROLE service_role');return db.query(sql,params)}
    await step('B24 revision UPDATE rejected',()=>reject(()=>protectedWrite('UPDATE public.workday_calculation_revisions SET integrity_hash=$1 WHERE id=$2',['bad',revision]),'42501'))
    await step('B25 revision DELETE rejected',()=>reject(()=>protectedWrite('DELETE FROM public.workday_calculation_revisions WHERE id=$1',[revision]),'42501'))
    await step('B26 audit UPDATE/DELETE rejected',async()=>{await reject(()=>protectedWrite('UPDATE public.workday_revision_promotions SET actor=$1 WHERE promoted_revision_id=$2',['bad',revision]),'42501');await reject(()=>protectedWrite('DELETE FROM public.workday_revision_promotions WHERE promoted_revision_id=$1',[revision]),'42501')})
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
  }finally{try{await db.query('ROLLBACK');assert.deepEqual(await counts(),before);console.log('DBREAL_CLEAN=YES')}finally{await db.end()}}
})
