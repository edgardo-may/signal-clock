import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createRequire } from 'node:module'
import * as domain from '../../src/domain/attendance/index.ts'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate, evolutionPayload } from '../helpers/workdayEvolutionDbreal.js'
import { cleanupRevisionFixture, revisionRpc, revisionRpcAdapter, createRevisionReadRepository, createTestCalculationEngineRegistry } from '../helpers/workdayRevisionDbreal.js'

const require=createRequire(import.meta.url)
const { evidenceManifest,fingerprint }=require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const { WorkdayPersistenceService }=require('../../backend/services/attendance/WorkdayPersistenceService.js')
const { AttendanceEngineOrchestrator }=require('../../backend/services/attendance/AttendanceEngineOrchestrator.js')
const { engineV4 }=require('../fixtures/calculation-engine-v4.cjs')
const url=process.env.PHASE2_AUDIT_DATABASE_URL

const tables=['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox','incidencias','rate_limits_logs','workday_calculation_revisions','workday_revision_promotions','tenant_features']
const begin=async db=>{await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")}
const settled=promise=>promise.then(value=>({value}),error=>({error}))

test('Phase B real transactions, evidence linearization and guaranteed fixture cleanup',{skip:!url&&'Explicit local DBREAL URL required'},async t=>{
  const target=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(target.port,'54322')
  const clients=[],fixtures=[]
  const connect=async()=>{const db=new pg.Client({connectionString:url});await db.connect();clients.push(db);await db.query("SET statement_timeout='10s'");return db}
  const admin=await connect(),a=await connect(),b=await connect()
  const counts=async()=>{const result={};for(const table of tables)result[table]=(await admin.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;return result}
  const baseline=await counts()
  const incidentsBefore=(await admin.query('SELECT to_jsonb(i) row FROM public.incidencias i ORDER BY id')).rows
  const step=async(name,fn)=>{let failure;await t.test(name,async()=>{try{await fn()}catch(error){failure=error;throw error}});if(failure)throw failure}
  const blocked=async db=>{
    for(let i=0;i<100;i++){
      if((await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[db.processID])).rows[0]?.wait_event_type==='Lock')return
      await new Promise(resolve=>setTimeout(resolve,25))
    }
    throw Error('CONCURRENCY_BARRIER_NOT_REACHED')
  }
  const seed=async()=>{
    await begin(admin)
    const f=await createWorkdayEvolutionFixture(admin);fixtures.push(f)
    await enableFixturePersistGate(admin,f.tenantA.id)
    const reg=await createCanonicalRegistro(admin,f,{occurredAt:'2030-06-10T14:00:00.000Z'})
    const record=evolutionPayload(f,reg.id)
    record.evidence_manifest=evidenceManifest(domain,(await admin.query('SELECT * FROM public.registro_asistencia WHERE id=$1',[reg.id])).rows,f.tenantA.id,f.employee.id,record.workday_date)
    record.context_manifest={context_manifest_version:1,calculation_version:3,schedule_id:f.schedule.id,schedule_revision_id:f.revision.id,timezone:'America/Cancun',scheduled_start:'2030-06-10T14:00:00.000Z',scheduled_end:'2030-06-10T23:00:00.000Z',tolerance_minutes:10,window_before_minutes:120,window_after_minutes:180,window_start_utc:'2030-06-10T12:00:00.000Z',window_end_utc:'2030-06-11T02:00:00.000Z',deduplication:{min_seconds:60,mode:'KEEP_FIRST',fixed_window:true},scheduled_break_minutes:0,auto_deduct_scheduled_break:false}
    await new WorkdayPersistenceService(revisionRpcAdapter(admin)).persist(record)
    const w=(await admin.query('SELECT * FROM public.workday_records WHERE cliente_id=$1',[f.tenantA.id])).rows[0]
    const snapshot=(await admin.query('SELECT snapshot FROM public.workday_calculation_revisions WHERE id=$1',[w.current_revision_id])).rows[0].snapshot
    const candidates=[]
    for(const seconds of [60,0])candidates.push((await revisionRpc(admin,'create_workday_revision_candidate',{
      p_cliente_id:f.tenantA.id,p_empleado_id:f.employee.id,p_workday_date:record.workday_date,
      p_snapshot:{...snapshot,calculation_version:4,integrity_hash:'4'.repeat(64)},p_evidence_manifest:record.evidence_manifest,
      p_context_manifest:{...record.context_manifest,calculation_version:4,deduplication:{min_seconds:seconds,mode:'KEEP_FIRST',fixed_window:true}},
      p_source_observed_at:record.source_observed_at,p_source_event_count:1,
    }))[0].revision_id)
    await admin.query('COMMIT')
    return{f,record,w,candidates,reg}
  }
  const promotion=(s,id)=>({p_cliente_id:s.f.tenantA.id,p_empleado_id:s.f.employee.id,p_workday_date:s.record.workday_date,p_candidate_revision_id:id,p_expected_current_revision_id:s.w.current_revision_id,p_expected_evidence_fingerprint:fingerprint(s.record.evidence_manifest)})
  const current=async s=>(await admin.query('SELECT * FROM public.workday_records WHERE id=$1',[s.w.id])).rows[0]
  try{
    await step('C1 simultaneous promotions: one winner and one conflict',async()=>{
      const s=await seed();await begin(a);await begin(b)
      assert.equal((await revisionRpc(a,'promote_workday_revision',promotion(s,s.candidates[0])))[0].promotion_result,'PROMOTED')
      const second=settled(revisionRpc(b,'promote_workday_revision',promotion(s,s.candidates[1])))
      await blocked(b);await a.query('COMMIT')
      assert.equal((await second).error?.message,'PROMOTION_CONFLICT');await b.query('ROLLBACK')
      assert.equal((await current(s)).current_revision_id,s.candidates[0])
      assert.equal((await admin.query("SELECT count(*)::int n FROM public.workday_revision_promotions WHERE cliente_id=$1 AND operation='PROMOTION'",[s.f.tenantA.id])).rows[0].n,1)
    })
    await step('C2 insert commits before validation: promotion conflicts without mutation',async()=>{
      const s=await seed();await begin(a)
      await createCanonicalRegistro(a,s.f,{occurredAt:'2030-06-10T23:00:15.000Z'})
      await begin(b);const promote=settled(revisionRpc(b,'promote_workday_revision',promotion(s,s.candidates[0])))
      await blocked(b);await a.query('COMMIT')
      assert.equal((await promote).error?.message,'PROMOTION_CONFLICT');await b.query('ROLLBACK')
      assert.equal((await current(s)).current_revision_id,s.w.current_revision_id)
    })
    await step('C3 insert after validation waits; evidence then UPDATED through CURRENT v4 registry',async()=>{
      const s=await seed();await begin(a)
      assert.equal((await revisionRpc(a,'promote_workday_revision',promotion(s,s.candidates[0])))[0].promotion_result,'PROMOTED')
      await begin(b);const inserting=settled(createCanonicalRegistro(b,s.f,{occurredAt:'2030-06-10T23:00:15.000Z'}))
      await blocked(b);await a.query('COMMIT')
      const inserted=await inserting;if(inserted.error)throw inserted.error
      await b.query("UPDATE public.registro_asistencia SET tipo_verificacion='salida' WHERE id=$1",[inserted.value.id]);await b.query('COMMIT')
      assert.equal((await current(s)).current_revision_id,s.candidates[0])
      await begin(admin)
      const registry=createTestCalculationEngineRegistry([engineV4])
      const runtime=new AttendanceEngineOrchestrator({repository:createRevisionReadRepository(admin),domain,logger:{},engineResolver:version=>registry.get(version),executionMode:'ACTIVE',persistenceMode:'PERSIST',persistenceService:new WorkdayPersistenceService(revisionRpcAdapter(admin))})
      const result=await runtime.run({registroId:inserted.value.id});await admin.query('COMMIT')
      assert.deepEqual(registry.requestedVersions,[4]);assert.deepEqual(registry.executedVersions,[4]);assert.equal(result.persistenceResult,'UPDATED')
      assert.equal((await current(s)).id,s.w.id);assert.equal((await current(s)).calculation_version,4);assert.equal((await current(s)).worked_minutes,541)
    })
    await step('C4 effective evidence mutation committed before validation is detected',async()=>{
      const s=await seed();await begin(a)
      await a.query("UPDATE public.registro_asistencia SET tipo_verificacion='salida' WHERE id=$1",[s.reg.id])
      await begin(b);const promote=settled(revisionRpc(b,'promote_workday_revision',promotion(s,s.candidates[0])))
      await blocked(b);await a.query('COMMIT')
      assert.equal((await promote).error?.message,'PROMOTION_CONFLICT');await b.query('ROLLBACK')
      assert.equal((await current(s)).current_revision_id,s.w.current_revision_id)
    })
    await step('C5 assertion and connection errors always run cleanup with trigger incidents intact',async()=>{
      const before=await counts();let fixture
      await assert.rejects(async()=>{
        try{
          const s=await seed();fixture=s.f
          await begin(a);await createCanonicalRegistro(a,fixture,{occurredAt:'2030-06-10T23:00:15.000Z'});await a.query('COMMIT')
          assert.equal((await admin.query('SELECT count(*)::int n FROM public.incidencias WHERE cliente_id=$1',[fixture.tenantA.id])).rows[0].n,1)
          const bad=await connect();await bad.end();await assert.rejects(()=>bad.query('SELECT 1'))
          assert.fail('EXPECTED_HARNESS_FAILURE')
        }finally{
          for(const db of clients)await db.query('ROLLBACK').catch(()=>{})
          if(fixture){await cleanupRevisionFixture(admin,fixture);fixtures.splice(fixtures.indexOf(fixture),1)}
        }
      },{message:'EXPECTED_HARNESS_FAILURE'})
      assert.deepEqual(await counts(),before)
    })
  }finally{
    try{
      for(const db of clients)await db.query('ROLLBACK').catch(()=>{})
      for(const fixture of fixtures)await cleanupRevisionFixture(admin,fixture)
      assert.deepEqual(await counts(),baseline)
      assert.deepEqual((await admin.query('SELECT to_jsonb(i) row FROM public.incidencias i ORDER BY id')).rows,incidentsBefore)
      console.log('CONCURRENCY_RUNNER_CLEANUP=PASS INCIDENT_BASELINE_RESTORED=YES DBREAL_CLEAN=YES')
    }finally{await Promise.all(clients.map(db=>db.end()))}
  }
})
