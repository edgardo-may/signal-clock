/** Horarios only: fixed production host, HTTP GET only, no RPC execution. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { computeScheduleRevisionIntegrityHash } from '../src/domain/attendance/adapters/ScheduleRevisionAdapter.ts'

const approvedHost='tuhrqoihccfumlaxnbor.supabase.co'
const env={}
for(const line of (await readFile(new URL('../backend/.env',import.meta.url),'utf8')).split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'')
}
const target=new URL(env.SUPABASE_URL)
if(target.protocol!=='https:'||target.hostname!==approvedHost||target.username||target.password)throw new Error('HORARIOS_PRODUCTION_HOST_DENIED')
if(!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('HORARIOS_READ_CREDENTIAL_MISSING')
let getCalls=0
async function get(path,params={},headers={}){
  const url=new URL('/rest/v1/'+path,target)
  for(const [k,v]of Object.entries(params))url.searchParams.set(k,v)
  getCalls++
  const res=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,...headers}})
  if(!res.ok)throw new Error('HORARIOS_READ_HTTP_'+res.status+'_'+(path||'schema'))
  return res.json()
}
async function all(table,select){
  const rows=[]
  for(let page=0;page<10000;page++){
    const batch=await get(table,{select,order:'id.asc',limit:'1000',offset:String(page*1000)})
    if(!Array.isArray(batch))throw new Error('INVALID_TABLE_RESPONSE')
    rows.push(...batch)
    if(batch.length<1000)return rows
  }
  throw new Error('PAGINATION_LIMIT')
}
const startedAt=new Date().toISOString()
const [schedules,assignments,revisions,employees,api]=await Promise.all([
  all('horarios','id,cliente_id,activo,folio,archived_at,archived_by,archive_reason,dias_config,tolerancia_minutos'),
  all('empleados_horarios','id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo,schedule_revision_id'),
  all('schedule_revisions','id,cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,reason'),
  all('empleados','id,cliente_id,activo'),
  get('',{}, {Accept:'application/openapi+json'}),
])
const bySchedule=new Map(schedules.map(r=>[r.id,r])),byEmployee=new Map(employees.map(r=>[r.id,r])),byRevision=new Map(revisions.map(r=>[r.id,r]))
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cancun',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const issues=[]
const unrevisionedSchedules=[]
const issue=(code,row)=>issues.push({code,id:row.id})
for(const s of schedules){
  if(!Number.isSafeInteger(s.folio)||s.folio<1)issue('INVALID_FOLIO',s)
  if(s.archived_at ? (!s.archived_by||!s.archive_reason?.trim()) : (s.archived_by!==null||s.archive_reason!==null))issue('INCOMPLETE_ARCHIVE',s)
  if(!revisions.some(r=>r.horario_id===s.id&&r.cliente_id===s.cliente_id)){
    if(!s.archived_at||assignments.some(a=>a.horario_id===s.id))issue('SCHEDULE_WITHOUT_REVISION',s)
    unrevisionedSchedules.push({id:s.id,folio:s.folio,active:s.activo,archived:Boolean(s.archived_at),assignments:assignments.filter(a=>a.horario_id===s.id).length,active_assignments:assignments.filter(a=>a.horario_id===s.id&&a.activo).length})
  }
}
const revisionKeys=new Set(),folioKeys=new Set()
for(const s of schedules){const k=s.cliente_id+':'+s.folio;if(folioKeys.has(k))issue('DUPLICATE_COMPANY_FOLIO',s);folioKeys.add(k)}
for(const r of revisions){
  const s=bySchedule.get(r.horario_id)
  if(!s||s.cliente_id!==r.cliente_id)issue('REVISION_COMPANY_MISMATCH',r)
  if(computeScheduleRevisionIntegrityHash(r.config_snapshot)!==r.integrity_hash)issue('REVISION_HASH_MISMATCH',r)
  if(!r.reason?.trim())issue('REVISION_REASON_MISSING',r)
  const k=r.horario_id+':'+r.version;if(revisionKeys.has(k))issue('REVISION_VERSION_DUPLICATE',r);revisionKeys.add(k)
}
let active=0,historical=0,currentOrFuture=0
for(const a of assignments){
  const s=bySchedule.get(a.horario_id),e=byEmployee.get(a.empleado_id),r=byRevision.get(a.schedule_revision_id)
  if(!e||e.cliente_id!==a.cliente_id||!s||s.cliente_id!==a.cliente_id)issue('ASSIGNMENT_COMPANY_MISMATCH',a)
  if(a.fecha_fin!==null&&a.fecha_fin<a.fecha_inicio)issue('ASSIGNMENT_RANGE_INVALID',a)
  if(a.schedule_revision_id&&(!r||r.cliente_id!==a.cliente_id||r.horario_id!==a.horario_id))issue('ASSIGNMENT_REVISION_MISMATCH',a)
  if(!a.activo||a.fecha_fin&&a.fecha_fin<today)historical++
  if(a.activo){
    active++
    if(!r)issue('ACTIVE_ASSIGNMENT_REVISION_MISSING',a)
    if(!a.fecha_fin||a.fecha_fin>=today){currentOrFuture++;if(!e?.activo)issue('CURRENT_ASSIGNMENT_INACTIVE_EMPLOYEE',a);if(s?.archived_at)issue('CURRENT_ASSIGNMENT_ARCHIVED_SCHEDULE',a)}
    if(r&&r.effective_from>a.fecha_inicio)issue('REVISION_EFFECTIVE_AFTER_ASSIGNMENT_START',a)
  }
}
for(let i=0;i<assignments.length;i++)for(let j=i+1;j<assignments.length;j++){
  const a=assignments[i],b=assignments[j]
  if(a.activo&&b.activo&&a.cliente_id===b.cliente_id&&a.empleado_id===b.empleado_id&&a.fecha_inicio<=(b.fecha_fin||'9999-12-31')&&b.fecha_inicio<=(a.fecha_fin||'9999-12-31'))issue('ACTIVE_RANGE_OVERLAP',a)
}
const signatures={apply_schedule_catalog_revision:['p_cliente_id','p_action','p_horario_id','p_nombre','p_descripcion','p_color','p_snapshot','p_effective_date','p_reason','p_correlation_id'],archive_schedule:['p_schedule_id','p_reason','p_correlation_id'],apply_employee_schedule_lifecycle:['p_cliente_id','p_empleado_ids','p_action','p_horario_id','p_effective_date','p_fecha_fin','p_assignment_id','p_reason','p_correlation_id','p_retroactive_confirmed','p_preview_only']}
const exposed={}
for(const [name,args]of Object.entries(signatures)){
  const op=api.paths?.['/rpc/'+name]?.post
  const ref=op?.parameters?.find(p=>p.in==='body')?.schema?.$ref
  const def=ref?api.definitions?.[ref.split('/').at(-1)]:op?.parameters?.find(p=>p.in==='body')?.schema
  const props=Object.keys(def?.properties||{})
  exposed[name]={present:Boolean(op),arguments_match:args.every(a=>props.includes(a)),argument_count:props.length}
  if(!exposed[name].present||!exposed[name].arguments_match)issues.push({code:'RPC_SIGNATURE_MISSING',name})
}
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex')
// Second read verifies observed rows were stable through this GET window.
const again=await Promise.all([
  all('horarios','id,cliente_id,activo,folio,archived_at,archived_by,archive_reason,dias_config,tolerancia_minutos'),
  all('empleados_horarios','id,cliente_id,empleado_id,horario_id,fecha_inicio,fecha_fin,activo,schedule_revision_id'),
  all('schedule_revisions','id,cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,reason'),
  all('empleados','id,cliente_id,activo'),
])
const stable=again.every((r,i)=>digest(r)===digest([schedules,assignments,revisions,employees][i]))
if(!stable)issues.push({code:'CONCURRENT_ROW_CHANGE_DURING_READ'})
const result={started_at:startedAt,checked_at:new Date().toISOString(),scope:'Horarios only; GET-only REST observations, catalog definitions from supplied snapshot',production_host:approvedHost,today_cancun:today,get_calls:getCalls,write_calls:0,rpc_calls:0,counts:{schedules:schedules.length,assignments:assignments.length,revisions:revisions.length,employees:employees.length,active_assignments:active,current_or_future_assignments:currentOrFuture,historical_assignments:historical,archived_schedules:schedules.filter(s=>s.archived_at).length},rpc_signatures:exposed,observations_stable:stable,issues,data_checks_pass:issues.length===0,digests:{schedules:digest(schedules),assignments:digest(assignments),revisions:digest(revisions),employee_identity_only:digest(employees)}}
result.unrevisioned_schedules=unrevisionedSchedules
result.legacy_archived_without_revision=unrevisionedSchedules.filter(s=>s.archived&&s.assignments===0).length
await writeFile(new URL('../docs/horarios-production-readiness-evidence.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
console.log('Production GET-only Horarios: '+result.get_calls+' GET; 0 writes; 0 RPC calls.')
console.log('Schedules '+schedules.length+'; assignments '+assignments.length+'; revisions '+revisions.length+'; historical assignments '+historical+'.')
console.log('Stable observations: '+stable+'; issues: '+issues.map(x=>x.code).join(', '))
for(const [name,r]of Object.entries(exposed))console.log(name+': present='+r.present+' signature='+r.arguments_match)
for(const s of unrevisionedSchedules)console.log('Unrevisioned folio '+s.folio+' active='+s.active+' archived='+s.archived+' assignments='+s.assignments+' active_assignments='+s.active_assignments)
if(issues.length)process.exitCode=1
