import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'

// Fixed local target. No application .env, credentials or production fallback.
// Supabase's postgres role cannot ALTER DEFAULT PRIVILEGES FOR supabase_admin.
// The isolated local superuser is required to exercise both creators honestly.
const url='postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres'
const tables=['attendance_logs','attendance_source_events','audit_logs','biometric_templates','cliente_modulos','clientes','dias_festivos','empleados','incidencias','login_attempts','module_catalog','periodos_nomina','rate_limits_logs','registro_asistencia','user_module_permissions','usuarios_perfiles','workday_records','empleados_horarios','horarios']
const root=new URL('../../',import.meta.url)
const core=await readFile(new URL('database/live-schema/proposals/global_security_minimum_candidate.sql',root),'utf8')
const defaults=await readFile(new URL('database/live-schema/proposals/global_security_hardening_v2_defaults.sql',root),'utf8')
const snapshotPath=process.env.SIGNUM_CATALOG_SECURITY_FILE || 'C:/Users/Edgar/Desktop/full_catalog_security.txt'
const snapshot=JSON.parse(await readFile(snapshotPath,'utf8'))[0].full_production_catalog_snapshot
const sha=b=>createHash('sha256').update(b).digest('hex')

test('Minimum candidate + separate defaults MODEL: DBREAL rollback, no skips', async t=>{
  const db=new pg.Client({connectionString:url,connectionTimeoutMillis:5000})
  await db.connect()
  const files=[]
  const frozen=await Promise.all(files.map(f=>readFile(new URL('database/live-schema/'+f,root)).then(sha)))
  const rows=async()=>{
    const out={}
    for(const {name} of (await db.query("select quote_ident(relname) name from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows)
      out[name]=(await db.query(`select count(*)::int count,md5(coalesce(string_agg(to_jsonb(r)::text,'' order by to_jsonb(r)::text),'')) digest from public.${name} r`)).rows[0]
    return out
  }
  const protectedCatalog=async()=>(await db.query(`select
    (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public') policies,
    (select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relname in ('devices','dispositivos','device_commands','device_employee_assignments','device_registration_requests','device_registration_request_audit')) devices,
    (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'acl',proacl,'def',pg_get_functiondef(oid)) order by oid::regprocedure::text) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in ('fn_employee_insert_sync','fn_generar_faltas_diarias')) routines`)).rows[0]
  async function asRole(role,sql,args=[]){
    assert.ok(['anon','authenticated','service_role'].includes(role))
    await db.query('SAVEPOINT role_probe')
    try{await db.query(`SET LOCAL ROLE ${role}`);return await db.query(sql,args)}
    finally{await db.query('ROLLBACK TO SAVEPOINT role_probe');await db.query('RELEASE SAVEPOINT role_probe')}
  }
  const before=await rows()
  const catalogBaseline=async()=>(await db.query(`select
    (select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r') tables,
    (select jsonb_agg(jsonb_build_object('relation',attrelid,'column',attnum,'acl',attacl) order by attrelid,attnum) from pg_attribute where attrelid in(select oid from pg_class where relnamespace='public'::regnamespace and relkind='r') and attnum>0 and not attisdropped) columns,
    (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d) defaults,
    (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'acl',proacl,'def',pg_get_functiondef(oid)) order by oid::regprocedure::text) from pg_proc where pronamespace='public'::regnamespace and prokind='f') functions`)).rows[0]
  const originalCatalog=await catalogBaseline()
  await db.query('BEGIN')
  try{
    await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'")
    // Reproduce ONLY the two live RPC bodies and their exposure as disposable
    // transaction fixtures, not by applying any historical migration.
    for(const name of ['fn_employee_insert_sync','fn_generar_faltas_diarias']){
      const r=snapshot.sections.routines.find(r=>r.name===name)
      assert.ok(r?.definition,'complete production RPC definition required')
      await db.query(r.definition)
      const signature=name==='fn_employee_insert_sync'?'uuid,jsonb':''
      await db.query(`ALTER FUNCTION public.${name}(${signature}) OWNER TO postgres`)
      await db.query(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO PUBLIC,anon,authenticated,service_role`)
    }
    // Baseline reproduction of the observed non-row grants, including a
    // column-level REFERENCES grant to detect an incomplete table-only repair.
    for(const table of tables)await db.query(`GRANT TRUNCATE,TRIGGER,MAINTAIN,REFERENCES ON public.${table} TO anon,authenticated`)
    await db.query('GRANT REFERENCES(id) ON public.empleados TO authenticated')
    const untouched=await protectedCatalog()
    const rowGrants=async()=>(await db.query(`select c.relname,r.role,p.privilege,has_table_privilege(r.role,c.oid,p.privilege) allowed
      from pg_class c cross join (values('anon'),('authenticated'),('service_role')) r(role)
      cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)
      where c.relnamespace='public'::regnamespace and c.relname=any($1) order by 1,2,3`,[tables])).rows
    const rowBefore=await rowGrants()
    await db.query("SET LOCAL signum.hardening_design='DBREAL_ROLLBACK_ONLY'")
    await t.test('core changes no business rows, row grants, device contracts or policies',async()=>{
      await db.query(core)
      assert.deepEqual(await rows(),before)
      assert.deepEqual(await rowGrants(),rowBefore)
      assert.deepEqual(await protectedCatalog(),untouched)
    })
    const live=snapshot;
    for(const name of ['fn_login_colaborador','fn_registrar_asistencia_colaborador']) await db.query(live.sections.routines.find(r=>r.name===name).definition);
    for(const {policyname} of (await db.query("select policyname from pg_policies where schemaname='public' and tablename='registro_asistencia'")).rows) await db.query('DROP POLICY "'+policyname.replaceAll('"','""')+'" ON public.registro_asistencia');
    for(const p of live.sections.policies.filter(p=>p.tablename==='registro_asistencia')) await db.query('CREATE POLICY "'+p.policyname+'" ON public.registro_asistencia AS '+p.permissive+' FOR '+p.cmd+' TO '+p.roles.join(',')+(p.qual?' USING ('+p.qual+')':'')+(p.with_check?' WITH CHECK ('+p.with_check+')':''));
    await db.query("SET LOCAL signum.employee_design='DBREAL_ROLLBACK_ONLY'");
    await db.query(await readFile(new URL('../../database/live-schema/proposals/employee_web_clock_candidate.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/live-schema/proposals/web_clock_canonical_source_delta.sql',import.meta.url),'utf8'));
    for(const table of tables)for(const role of ['anon','authenticated']){
      await t.test(`${role} cannot TRUNCATE ${table}, including CASCADE`,async()=>{
        await assert.rejects(asRole(role,`TRUNCATE TABLE public.${table} CASCADE`),e=>e.code==='42501')
        for(const privilege of ['TRUNCATE','TRIGGER','MAINTAIN','REFERENCES'])
          assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.'+table,privilege])).rows[0].allowed,false)
        assert.equal((await db.query(`select bool_or(has_column_privilege($1,a.attrelid,a.attnum,'REFERENCES')) allowed from pg_attribute a where a.attrelid=$2::regclass and a.attnum>0 and not a.attisdropped`,[role,'public.'+table])).rows[0].allowed,false)
      })
    }
    for(const role of ['anon','authenticated'])for(const call of ["select public.fn_employee_insert_sync('00000000-0000-0000-0000-000000000001','{}')",'select public.fn_generar_faltas_diarias()'])
      await t.test(`${role} denied privileged RPC: ${call.split('(')[0]}`,async()=>{
        await assert.rejects(asRole(role,call),e=>e.code==='42501')
      })
    await t.test('service_role retains tables and RPC boundary; fixed search_path',async()=>{
      for(const table of tables)for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES'])
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',['service_role','public.'+table,p])).rows[0].allowed,true)
      for(const signature of ['fn_employee_insert_sync(uuid,jsonb)','fn_generar_faltas_diarias()']){
        assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",['public.'+signature])).rows[0].allowed,true)
        assert.ok((await db.query('select proconfig from pg_proc where oid=$1::regprocedure',['public.'+signature])).rows[0].proconfig.includes('search_path=pg_catalog, public, pg_temp'))
      }
      // A semantic error, rather than 42501, demonstrates service_role enters
      // the actual live sync body. No employee fixture or attendance is created.
      await assert.rejects(asRole('service_role',"select public.fn_employee_insert_sync('00000000-0000-0000-0000-000000000001','{}')"),e=>e.message==='SIN_CLAVE')
    })
    await t.test('service_role positive sync CREATED/EXISTS/LIMIT preserves tenant and capacity',async()=>{
      await db.query('SAVEPOINT positive_sync')
      try {
        const tenant=(await db.query("insert into public.clientes(nombre_empresa,limite_empleados) values('V2A FIXTURE ONLY',1) returning id")).rows[0].id
        await db.query('SET LOCAL ROLE service_role')
        const invoke=async clave=>(await db.query('select public.fn_employee_insert_sync($1,$2) result',[tenant,{clave_empleado:clave,nombre:'V2A',apellido:'Fixture'}])).rows[0].result
        const created=await invoke('V2A-001')
        assert.equal(created.result,'CREATED')
        assert.equal((await invoke('v2a-001')).result,'EXISTS')
        assert.equal((await invoke('V2A-002')).result,'LIMIT')
        const rows=(await db.query('select id,cliente_id,clave_empleado from public.empleados where cliente_id=$1',[tenant])).rows
        assert.equal(rows.length,1);assert.equal(rows[0].id,created.id);assert.equal(rows[0].cliente_id,tenant)
      } finally { await db.query('ROLLBACK TO SAVEPOINT positive_sync');await db.query('RELEASE SAVEPOINT positive_sync') }
    })
    await t.test('V2-B MODEL ONLY: defaults on both creators, rolled back and excluded from core',async()=>{
      await db.query("SET LOCAL signum.global_function_defaults_reviewed='DBREAL_PROBE_ONLY'")
      await db.query(defaults)
      for(const [i,owner] of ['postgres','supabase_admin'].entries()){
        await db.query(`SET LOCAL ROLE ${owner}`)
        await db.query(`CREATE TABLE public.gsh_probe_${i}(id int); CREATE SEQUENCE public.gsh_seq_${i}; CREATE FUNCTION public.gsh_fn_${i}() RETURNS int LANGUAGE sql AS 'SELECT 1'`)
        await db.query('RESET ROLE')
        for(const role of ['anon','authenticated']){
          for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,`public.gsh_probe_${i}`,p])).rows[0].allowed,false)
          for(const p of ['USAGE','SELECT','UPDATE'])assert.equal((await db.query('select has_sequence_privilege($1,$2,$3) allowed',[role,`public.gsh_seq_${i}`,p])).rows[0].allowed,false)
          await assert.rejects(asRole(role,`select public.gsh_fn_${i}()`),e=>e.code==='42501')
        }
        assert.equal((await asRole('service_role',`select public.gsh_fn_${i}() value`)).rows[0].value,1)
        assert.equal((await db.query("select has_table_privilege('service_role',$1,'INSERT') allowed",[`public.gsh_probe_${i}`])).rows[0].allowed,true)
        assert.equal((await db.query("select has_sequence_privilege('service_role',$1,'USAGE') allowed",[`public.gsh_seq_${i}`])).rows[0].allowed,true)
      }
      // Verify the non-obvious global scope rather than claiming IN SCHEMA can
      // suppress the built-in PUBLIC default. All objects are rolled back.
      await db.query('CREATE SCHEMA gsh_other_schema')
      await db.query("CREATE FUNCTION gsh_other_schema.probe() RETURNS int LANGUAGE sql AS 'SELECT 1'")
      assert.equal((await db.query("select has_function_privilege('anon','gsh_other_schema.probe()','EXECUTE') allowed")).rows[0].allowed,false)
    })
    await t.test('core is idempotent and frozen migrations untouched',async()=>{
      await db.query(core)
      assert.deepEqual(await Promise.all(files.map(f=>readFile(new URL('database/live-schema/'+f,root)).then(sha))),frozen)
    })
  }finally{
    await db.query('ROLLBACK')
    try{await t.test('rollback restores all pre-existing public data and removes probe objects',async()=>{
      assert.deepEqual(await rows(),before)
      assert.deepEqual(await catalogBaseline(),originalCatalog)
      assert.equal((await db.query("select to_regclass('public.gsh_probe_0') absent")).rows[0].absent,null)
    })}finally{await db.end()}
  }
})
