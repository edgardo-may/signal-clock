import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createRequire } from 'node:module'
import * as domain from '../../src/domain/attendance/index.ts'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, enableFixturePersistGate, evolutionPayload } from '../helpers/workdayEvolutionDbreal.js'
import { revisionRpc, revisionRpcAdapter } from '../helpers/workdayRevisionDbreal.js'

const require=createRequire(import.meta.url)
const { evidenceManifest,fingerprint }=require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const { WorkdayPersistenceService }=require('../../backend/services/attendance/WorkdayPersistenceService.js')
const url=process.env.PHASE2_AUDIT_DATABASE_URL
test('Phase B DBREAL role execution, identity and legacy provenance',{skip:!url&&'Explicit local DBREAL URL required'},async t=>{
  const target=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(target.port,'54322')
  const db=new pg.Client({connectionString:url});await db.connect()
  const tables=['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox','incidencias','rate_limits_logs','workday_calculation_revisions','workday_revision_promotions','tenant_features']
  const counts=async()=>{const result={};for(const table of tables)result[table]=(await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;return result}
  const baseline=await counts()
  const step=async(name,fn)=>{let failure;await t.test(name,async()=>{try{await fn()}catch(error){failure=error;throw error}});if(failure)throw failure}
  const reject=async(fn,message)=>{const before=await counts();await db.query('SAVEPOINT denied');try{await assert.rejects(fn,error=>error.code===message||error.message===message)}finally{await db.query('ROLLBACK TO SAVEPOINT denied')}assert.deepEqual(await counts(),before)}
  try{
    await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")
    const f=await createWorkdayEvolutionFixture(db);await enableFixturePersistGate(db,f.tenantA.id)
    const persist=new WorkdayPersistenceService(revisionRpcAdapter(db)),records=[]
    for(const day of ['10','11']){
      const stamp=`2030-06-${day}T14:00:00.000Z`,reg=await createCanonicalRegistro(db,f,{occurredAt:stamp})
      const record=evolutionPayload(f,reg.id,{workday_date:`2030-06-${day}`,first_in:stamp,source_observed_at:stamp})
      record.evidence_manifest=evidenceManifest(domain,(await db.query('SELECT * FROM public.registro_asistencia WHERE id=$1',[reg.id])).rows,f.tenantA.id,f.employee.id,record.workday_date)
      record.context_manifest={context_manifest_version:1,calculation_version:3,schedule_id:f.schedule.id,schedule_revision_id:f.revision.id,timezone:'America/Cancun',scheduled_start:stamp,scheduled_end:`2030-06-${day}T23:00:00.000Z`,tolerance_minutes:10,window_before_minutes:120,window_after_minutes:180,window_start_utc:`2030-06-${day}T12:00:00.000Z`,window_end_utc:`2030-06-${Number(day)+1}T02:00:00.000Z`,deduplication:{min_seconds:60,mode:'KEEP_FIRST',fixed_window:true},scheduled_break_minutes:0,auto_deduct_scheduled_break:false}
      await persist.persist(record)
      const w=(await db.query('SELECT * FROM public.workday_records WHERE cliente_id=$1 AND workday_date=$2',[f.tenantA.id,record.workday_date])).rows[0]
      records.push({record,w})
    }
    const {record,w}=records[0],other=records[1]
    const snap=(await db.query('SELECT snapshot FROM public.workday_calculation_revisions WHERE id=$1',[other.w.current_revision_id])).rows[0].snapshot
    const candidate=(await revisionRpc(db,'create_workday_revision_candidate',{p_cliente_id:f.tenantA.id,p_empleado_id:f.employee.id,p_workday_date:other.record.workday_date,p_snapshot:{...snap,calculation_version:4,integrity_hash:'4'.repeat(64)},p_evidence_manifest:other.record.evidence_manifest,p_context_manifest:{...other.record.context_manifest,calculation_version:4},p_source_observed_at:other.record.source_observed_at,p_source_event_count:1}))[0]
    const params={p_cliente_id:f.tenantA.id,p_empleado_id:f.employee.id,p_workday_date:record.workday_date,p_candidate_revision_id:candidate.revision_id,p_expected_current_revision_id:w.current_revision_id,p_expected_evidence_fingerprint:fingerprint(record.evidence_manifest)}
    await step('B11 foreign workday candidate rejected with zero mutation',()=>reject(()=>revisionRpc(db,'promote_workday_revision',params),'INVALID_IDENTITY'))
    await step('B15 legacy ordinary writer keeps NULL provenance without retrospective revision',async()=>{
      const before=(await db.query('SELECT count(*)::int n FROM public.workday_calculation_revisions')).rows[0].n
      const reg=await createCanonicalRegistro(db,f,{occurredAt:'2030-06-12T14:00:00.000Z'})
      const legacy=evolutionPayload(f,reg.id,{workday_date:'2030-06-12',first_in:'2030-06-12T14:00:00.000Z',source_observed_at:'2030-06-12T14:00:00.000Z'})
      assert.equal((await persist.persist(legacy)).persistenceResult,'INSERTED')
      const row=(await db.query('SELECT current_revision_id FROM public.workday_records WHERE cliente_id=$1 AND workday_date=$2',[f.tenantA.id,legacy.workday_date])).rows[0]
      assert.equal(row.current_revision_id,null)
      assert.equal((await db.query('SELECT count(*)::int n FROM public.workday_calculation_revisions')).rows[0].n,before)
    })
    await step('Immutable guards reject UPDATE/DELETE even for the isolated owner role',async()=>{
      await reject(()=>db.query('UPDATE public.workday_calculation_revisions SET integrity_hash=$1 WHERE id=$2',['bad',w.current_revision_id]),'WORKDAY_REVISION_IMMUTABLE')
      await reject(()=>db.query('DELETE FROM public.workday_calculation_revisions WHERE id=$1',[w.current_revision_id]),'WORKDAY_REVISION_IMMUTABLE')
      await reject(()=>db.query('UPDATE public.workday_revision_promotions SET actor=$1 WHERE promoted_revision_id=$2',['bad',w.current_revision_id]),'WORKDAY_REVISION_IMMUTABLE')
      await reject(()=>db.query('DELETE FROM public.workday_revision_promotions WHERE promoted_revision_id=$1',[w.current_revision_id]),'WORKDAY_REVISION_IMMUTABLE')
    })
    await step('RPC security: invoker only, RLS and exact role execution grants',async()=>{
      const catalog=(await db.query("SELECT oid,proname,prosecdef,pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname IN ('create_workday_revision_candidate','promote_workday_revision','store_workday_calculation_revision','validate_workday_revision_manifests','enforce_workday_revision_insert_identity') OR (proname='upsert_workday_record' AND pronargs IN (18,20)))")).rows
      assert.equal(catalog.length,7)
      for(const fn of catalog){assert.equal(fn.prosecdef,false);const grants=(await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') backend",[fn.oid])).rows[0];assert.deepEqual(grants,{anon:false,authenticated:false,backend:true})}
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE oid IN ('public.workday_calculation_revisions'::regclass,'public.workday_revision_promotions'::regclass) AND relrowsecurity")).rows[0].n,2)
      for(const role of ['anon','authenticated'])for(const fn of catalog){
        // Trigger routines execute through INSERT, covered by B16 direct guard;
        // PostgreSQL does not allow invoking them as ordinary table functions.
        if(fn.proname==='enforce_workday_revision_insert_identity')continue
        const types=fn.args ? fn.args.split(', ').map(arg=>arg.slice(arg.indexOf(' ')+1)) : []
        await reject(async()=>{await db.query('SET LOCAL ROLE '+role);await db.query(`SELECT * FROM public.${fn.proname}(${types.map(type=>'NULL::'+type).join(',')})`)},'42501')
      }
      await reject(()=>revisionRpc(db,'promote_workday_revision',params),'INVALID_IDENTITY')
      for(const role of ['anon','authenticated'])for(const table of ['workday_calculation_revisions','workday_revision_promotions'])await reject(async()=>{await db.query('SET LOCAL ROLE '+role);await db.query('SELECT * FROM public.'+table)},'42501')
    })
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
  }finally{try{await db.query('ROLLBACK');assert.deepEqual(await counts(),baseline);console.log('SECURITY_DBREAL_CLEAN=YES')}finally{await db.end()}}
})
