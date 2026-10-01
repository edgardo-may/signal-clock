import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import pg from 'pg'
import * as domain from '../../src/domain/attendance/index.ts'
import { createWorkdayEvolutionFixture, createCanonicalRegistro, evolutionPayload } from '../helpers/workdayEvolutionDbreal.js'

const require = createRequire(import.meta.url)
const { evidenceManifest, fingerprint } = require('../../backend/services/attendance/WorkdayRevisionManifests.js')
const url = process.env.PHASE2_AUDIT_DATABASE_URL
test('B16-A–H real DB authority and zero mutation', { skip: !url && 'Explicit local DBREAL URL required' }, async t => {
  const target = new URL(url)
  assert.ok(['127.0.0.1','localhost'].includes(target.hostname)); assert.equal(target.port,'54322')
  const db = new pg.Client({ connectionString: url }); await db.connect()
  const tracked = ['workday_calculation_revisions','workday_revision_promotions','workday_records','workday_record_history']
  const all = [...tracked,'clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','attendance_persist_outbox','incidencias','rate_limits_logs']
  const counts = async tables => { const out={}; for(const table of tables)out[table]=(await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n; return out }
  const baseline = await counts(all)
  const call = async (name, params) => {
    const keys=Object.keys(params); await db.query('SET LOCAL ROLE service_role')
    const result=(await db.query(`SELECT * FROM public.${name}(${keys.map((key,i)=>key+' => $'+(i+1)).join(',')})`,keys.map(key=>params[key]))).rows[0]
    await db.query('RESET ROLE'); return result
  }
  const reject = async fn => {
    const before=await counts(tracked); await db.query('SAVEPOINT rejection')
    try { await assert.rejects(fn,error=>error.message==='TENANT_MISMATCH') }
    finally { await db.query('ROLLBACK TO SAVEPOINT rejection') }
    assert.deepEqual(await counts(tracked),before,'zero revision/audit/workday/history mutation')
  }
  const step = async (name,fn) => { let failure; await t.test(name,async()=>{try{await fn()}catch(e){failure=e;throw e}});if(failure)throw failure }
  try {
    await db.query('BEGIN'); await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)")
    const fixture=await createWorkdayEvolutionFixture(db)
    const regA=await createCanonicalRegistro(db,fixture,{occurredAt:'2030-06-10T14:00:00.000Z'})
    const regB=await createCanonicalRegistro(db,fixture,{tenant:fixture.tenantB,employee:fixture.employeeB,device:fixture.deviceB,occurredAt:'2030-06-10T14:00:00.000Z'})
    const rows=(await db.query('SELECT * FROM public.registro_asistencia WHERE id=ANY($1::uuid[])',[[regA.id,regB.id]])).rows
    const context={context_manifest_version:1,calculation_version:3,schedule_id:null,schedule_revision_id:null,timezone:'America/Cancun',window_start_utc:'2030-06-10T12:00:00.000Z',window_end_utc:'2030-06-11T02:00:00.000Z'}
    const paramsFor=async(tenant,employee,reg)=>{
      const payload=evolutionPayload(fixture,reg.id,{cliente_id:tenant.id,empleado_id:employee.id,schedule_id:null})
      const snapshot=(await db.query('SELECT public.workday_revision_snapshot(to_jsonb(jsonb_populate_record(NULL::public.workday_records,$1::jsonb))) snapshot',[JSON.stringify(payload)])).rows[0].snapshot
      return {p_cliente_id:tenant.id,p_empleado_id:employee.id,p_date:payload.workday_date,p_version:3,p_evidence:evidenceManifest(domain,rows.filter(r=>r.id===reg.id),tenant.id,employee.id,payload.workday_date),p_context:context,p_snapshot:snapshot,p_hash:payload.integrity_hash,p_observed:payload.source_observed_at,p_count:1}
    }
    const a=await paramsFor(fixture.tenantA,fixture.employee,regA)
    const b=await paramsFor(fixture.tenantB,fixture.employeeB,regB)
    const store=p=>call('store_workday_calculation_revision',p)
    await step('B16-A client B + employee A',()=>reject(()=>store({...a,p_cliente_id:fixture.tenantB.id})))
    await step('B16-B foreign manifest header',()=>reject(()=>store({...a,p_evidence:{...a.p_evidence,cliente_id:fixture.tenantB.id}})))
    await step('B16-C foreign registro in manifest',()=>reject(()=>store({...a,p_evidence:{...a.p_evidence,events:b.p_evidence.events}})))
    await step('B16-D foreign source event ID',()=>reject(()=>store({...a,p_evidence:{...a.p_evidence,events:[{...a.p_evidence.events[0],source_event_id:b.p_evidence.events[0].source_event_id}]}})))
    await step('B16-E client A + employee B',()=>reject(()=>store({...a,p_empleado_id:fixture.employeeB.id})))
    let revA,revB
    await step('B16-F coherent tenant A',async()=>{revA=(await store(a)).store_workday_calculation_revision;assert.ok(revA)})
    await step('B16-G coherent tenant B',async()=>{revB=(await store(b)).store_workday_calculation_revision;assert.ok(revB)})
    await db.query(`INSERT INTO public.workday_records(cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version,source_observed_at,source_event_count,current_revision_id)
      SELECT $1,$2,$3,w.schedule_id,w.timezone,w.first_in,w.last_out,w.worked_minutes,w.break_minutes,w.overtime_minutes,w.late_minutes,w.early_leave_minutes,w.status,w.integrity_hash,w.calculation_version,$4,1,$5 FROM jsonb_populate_record(NULL::public.workday_records,$6::jsonb) w`,[a.p_cliente_id,a.p_empleado_id,a.p_date,a.p_observed,revA,JSON.stringify(a.p_snapshot)])
    await step('B16-H foreign candidate and explicit revision target',async()=>{
      await reject(()=>call('promote_workday_revision',{p_cliente_id:a.p_cliente_id,p_empleado_id:a.p_empleado_id,p_workday_date:a.p_date,p_candidate_revision_id:revB,p_expected_current_revision_id:revA,p_expected_evidence_fingerprint:fingerprint(a.p_evidence)}))
      await reject(()=>store({...a,p_snapshot:{...a.p_snapshot,revision_id:revB}}))
    })
    await step('B16 direct INSERT cannot bypass invoker helper',()=>reject(async()=>{
      await db.query('SET LOCAL ROLE service_role')
      await db.query(`INSERT INTO public.workday_calculation_revisions(cliente_id,empleado_id,workday_date,calculation_version,evidence_manifest_version,evidence_manifest,evidence_fingerprint,context_manifest_version,context_manifest,context_fingerprint,snapshot,integrity_hash,source_observed_at,source_event_count)
        SELECT $1,empleado_id,workday_date,calculation_version,evidence_manifest_version,evidence_manifest,evidence_fingerprint,context_manifest_version,context_manifest,context_fingerprint,snapshot,integrity_hash,source_observed_at,source_event_count FROM public.workday_calculation_revisions WHERE id=$2`,[fixture.tenantB.id,revA])
    }))
    console.log('B16_FIX_RESULT=PASS B16_CASES=8+DIRECT_INSERT_ZERO_MUTATION=PASS')
  }finally{try{await db.query('ROLLBACK');assert.deepEqual(await counts(all),baseline);console.log('DBREAL_CLEAN=YES')}finally{await db.end()}}
})
