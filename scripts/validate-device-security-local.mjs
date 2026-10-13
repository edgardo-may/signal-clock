/** Exact-loopback DBREAL only. Never reads the application's production .env. */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import pg from 'pg'

const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const startedAt = new Date().toISOString()
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 })
const file = 'database/live-schema/124_device_security_acl_hardening.sql'
const frozenNames = ['116_schedule_employee_guard_change.sql','117_device_registration_requests_authorization.sql']
const sha256 = data => createHash('sha256').update(data).digest('hex')
const repairShaBefore = sha256(await readFile(file))
const frozen = Object.fromEntries(await Promise.all(frozenNames.map(async name => [name,sha256(await readFile('database/live-schema/'+name))])))
const dataSnapshot = async () => {
  const data = {}
  for (const { name } of (await db.query("select quote_ident(c.relname) name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.relname")).rows) {
    data[name]=(await db.query(`select count(*)::int count,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) digest from public.${name} x`)).rows[0]
  }
  return data
}
await db.connect()
let before, after, auxiliaryBefore
try {
  before=await dataSnapshot()
  auxiliaryBefore={
    audit:(await db.query('select id from public.audit_logs')).rows.map(r=>r.id),
    rates:(await db.query('select id from public.rate_limits_logs')).rows.map(r=>r.id),
    folios:(await db.query('select cliente_id,catalog from public.tenant_catalog_folio_counters')).rows,
  }
  const sql=await readFile(file,'utf8')
  await db.query(sql)
  after=await dataSnapshot()
  if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('LOCAL_REPAIR_CHANGED_BUSINESS_ROWS')
  console.log('DBREAL local repair applied; all public business row counts/digests unchanged.')
} finally { await db.end() }

const localAuth=JSON.parse(execFileSync('docker',['inspect','supabase_auth_signum-dbreal-local'],{encoding:'utf8'}))[0]
const secret=localAuth.Config.Env.find(x=>x.startsWith('GOTRUE_JWT_SECRET='))?.slice('GOTRUE_JWT_SECRET='.length)
if(!secret) throw new Error('LOCAL_AUTH_TEST_SECRET_MISSING')
const keyFor = role => {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
  const now=Math.floor(Date.now()/1000)
  const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,iss:'supabase',iat:now,exp:now+3600})
  return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')
}
const env = {...process.env,
  SUPABASE_TEST_URL:'http://127.0.0.1:54321',
  SUPABASE_TEST_DB_URL:connectionString,
  PHASE2_AUDIT_DATABASE_URL:connectionString,
  PHASE2_AUDIT_DB_LABEL:'local',ALLOW_DESTRUCTIVE_TEST_DB:'true',
  SUPABASE_TEST_ANON_KEY:keyFor('anon'),SUPABASE_TEST_SERVICE_ROLE_KEY:keyFor('service_role'),
  HISTORY_HOTFIX_INSTALLED_CONTRACT:'true',HISTORY_HOTFIX_MODE:'verify',
}
const groups = {
  security_devices: [
    'device-security-hardening-dbreal','device-registration-requests-dbreal',
    'device-registration-migration-dbreal','device-registration-http-dbreal',
    'employee-deactivation-device-removal','employee-module-matrix','central-user-creation','hardening',
  ],
  attendance: [
    'attendance-engine','attendance-runtime-host','attendance-runtime-v3-persist',
    'attendance-device-tenant-identity-dbreal','attendance-entry-identity-repair-dbreal',
    'phase-99-source-event-link-order','phase-a-multi-pair-canonical',
    'phase-b-canonical-pairing','phase-b-dbreal-pairing',
    'phase-96-workday-evolution','dbreal-workday-evolution','dbreal-history-uniqueness',
    'dbreal-calculation-revisions','dbreal-revision-security','dbreal-revision-tenant-isolation',
    'dbreal-revision-continuation','dbreal-revision-concurrency','dbreal-rollback-runtime',
    'rollback-runtime-capability','dbreal-preflight-contract',
    'dbreal-auto-open-cycle','dbreal-duplicates','dbreal-multiple-punches','dbreal-overnight',
    'dbreal-dispatcher-retry-idempotency','productive-persist-dispatcher',
  ],
  horarios: [
    'schedule-local-date','schedule-resolver-current-semantics','schedule-revision-shadow',
    'revision-resolver-activation-gate','phase-46-schedule-assignment-contract-precheck',
    'phase-49-schedule-assignment-data-repair','phase-52-54-schedule-lifecycle',
    'phase-55-57-schedule-revisions','schedule-removal-permissions-dbreal',
    'schedule-same-start-reassignment-dbreal',
  ],
}
const results={}
let logs=''
for(const [name,files] of Object.entries(groups)) {
  console.log('Running '+name+' ('+files.length+' files)')
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...files.map(f=>'tests/compliance/'+f+'.test.js')],{env,encoding:'utf8',maxBuffer:20*1024*1024})
  const output=(result.stdout||'')+(result.stderr||'')
  logs+='\nGROUP '+name+'\n'+output
  const counts=Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]))
  const pass=result.status===0&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0
  results[name]={...counts,passed:pass,exitCode:result.status}
  console.log(JSON.stringify({group:name,...results[name]}))
  if(!pass) console.log(output.split('\n').filter(x=>/^\s*not ok |^\s*error:|^\s*code:/.test(x)).join('\n').slice(-6000))
  await writeFile('docs/device-security-hardening-test-output.txt',logs)
}
const finalDb=new pg.Client({connectionString});await finalDb.connect()
let finalData, fixtureAuxiliaryCleanup
try {
  // Older regression harnesses leave auxiliary audit/rate/folio rows after deleting
  // their exact disposable companies. Remove only newly observed IDs from this run.
  // Never run against another host; preserve all pre-existing IDs and existing companies.
  await finalDb.query('BEGIN')
  const newAudit=(await finalDb.query('select id,created_at,cliente_id from public.audit_logs where id<>all($1::uuid[])',[auxiliaryBefore.audit])).rows
  const newRates=(await finalDb.query('select id,creado_at from public.rate_limits_logs where id<>all($1::uuid[])',[auxiliaryBefore.rates])).rows
  const knownFolios=new Set(auxiliaryBefore.folios.map(r=>r.cliente_id+':'+r.catalog))
  const newFolios=(await finalDb.query('select f.cliente_id,f.catalog,c.id existing_company from public.tenant_catalog_folio_counters f left join public.clientes c on c.id=f.cliente_id')).rows.filter(r=>!knownFolios.has(r.cliente_id+':'+r.catalog))
  for(const row of newAudit) {
    if(new Date(row.created_at)<new Date(startedAt)||(await finalDb.query('select id from public.clientes where id=$1',[row.cliente_id])).rowCount)throw new Error('UNATTRIBUTED_LOCAL_AUDIT_RESIDUE')
  }
  if(newRates.some(r=>new Date(r.creado_at)<new Date(startedAt))||newFolios.some(r=>r.existing_company))throw new Error('UNATTRIBUTED_LOCAL_AUXILIARY_RESIDUE')
  await finalDb.query('delete from public.audit_logs where id=any($1::uuid[])',[newAudit.map(r=>r.id)])
  await finalDb.query('delete from public.rate_limits_logs where id=any($1::uuid[])',[newRates.map(r=>r.id)])
  for(const row of newFolios)await finalDb.query('delete from public.tenant_catalog_folio_counters where cliente_id=$1 and catalog=$2',[row.cliente_id,row.catalog])
  fixtureAuxiliaryCleanup={audit_ids:newAudit.map(r=>r.id),rate_ids:newRates.map(r=>r.id),folio_rows:newFolios}
  // Reuse the same snapshot semantics on the post-test connection.
  finalData={}
  for(const {name} of (await finalDb.query("select quote_ident(c.relname) name from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.relname")).rows) {
    finalData[name]=(await finalDb.query(`select count(*)::int count,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) digest from public.${name} x`)).rows[0]
  }
  if(JSON.stringify(before)!==JSON.stringify(finalData)) {
    console.log('Changed local tables:',Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(finalData[k])))
    throw new Error('LOCAL_FIXTURE_CLEANUP_DOES_NOT_RESTORE_EXACT_BASELINE')
  }
  await finalDb.query('COMMIT')
} catch(error){await finalDb.query('ROLLBACK');throw error}
finally {await finalDb.end()}
const frozenAfter=Object.fromEntries(await Promise.all(frozenNames.map(async name=>[name,sha256(await readFile('database/live-schema/'+name))])))
const report={checked_at:new Date().toISOString(),database:'DBREAL 127.0.0.1:54322',repair:file,
  repair_sha256:sha256(await readFile(file)),repair_sha256_applied:repairShaBefore,frozen_before:frozen,frozen_after:frozenAfter,
  business_rows_preserved_by_repair:JSON.stringify(before)===JSON.stringify(after),
  business_rows_preserved_after_tests:JSON.stringify(before)===JSON.stringify(finalData),
  before,after_tests:finalData,fixture_auxiliary_cleanup:fixtureAuxiliaryCleanup,results,production_writes:0,migration116_executed:false}
await writeFile('docs/device-security-hardening-dbreal-results.json',JSON.stringify(report,null,2)+'\n')
await writeFile('docs/device-security-hardening-test-output.txt',logs)
console.log('Evidence saved; production writes: 0; migration 116 executed: false.')
if(Object.values(results).some(r=>!r.passed)||JSON.stringify(frozen)!==JSON.stringify(frozenAfter)||!report.business_rows_preserved_after_tests||report.repair_sha256!==repairShaBefore) process.exitCode=1
