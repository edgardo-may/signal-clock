import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import { auditConfig } from '../helpers/testDb.js'

test('Horarios installed contract: no migration replay; rollback-only fixtures',async t=>{
  const config=auditConfig()
  assert.ok(config.ready, 'Explicit approved local DBREAL configuration required')
  const db=new pg.Client({connectionString:config.dbUrl,connectionTimeoutMillis:5000})
  await db.connect()
  const data=async(names)=>{
    const out={}
    for(const name of names)out[name]=(await db.query(`select count(*)::int n,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) digest from public.${name} x`)).rows[0]
    return out
  }
  const tables=(await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows.map(r=>r.relname)
  const original=await data(tables)
  const protectedTables=tables.filter(n=>/attendance|workday|tenant_features|device|dispositivos/.test(n))
  const protectedBefore=await data(protectedTables)
  const catalog=async()=>(await db.query(`select
    (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'acl',proacl,'definition',pg_get_functiondef(oid)) order by oid::regprocedure::text) from pg_proc where pronamespace='public'::regnamespace and prokind='f') routines,
    (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public') policies,
    (select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r') grants`)).rows[0]
  const originalCatalog=await catalog(); let catalogBefore
  await db.query('BEGIN');

    // Candidate installed only in this transaction, never persisted.
    const live=JSON.parse(await readFile('C:/Users/Edgar/Desktop/full_catalog_security.txt','utf8'))[0].full_production_catalog_snapshot;
    for(const name of ['fn_employee_insert_sync','fn_generar_faltas_diarias']){
      await db.query(live.sections.routines.find(r=>r.name===name).definition);
      await db.query('GRANT EXECUTE ON FUNCTION public.'+name+(name==='fn_employee_insert_sync'?'(uuid,jsonb)':'()')+' TO PUBLIC,anon,authenticated,service_role');
    }
    await db.query("SET LOCAL signum.hardening_design='DBREAL_ROLLBACK_ONLY'");
    await db.query(await readFile(new URL('../../database/live-schema/proposals/global_security_minimum_candidate.sql',import.meta.url),'utf8'));
    for(const name of ['fn_login_colaborador','fn_registrar_asistencia_colaborador']) await db.query(live.sections.routines.find(r=>r.name===name).definition);
    for(const {policyname} of (await db.query("select policyname from pg_policies where schemaname='public' and tablename='registro_asistencia'")).rows) await db.query('DROP POLICY "'+policyname.replaceAll('"','""')+'" ON public.registro_asistencia');
    for(const p of live.sections.policies.filter(p=>p.tablename==='registro_asistencia')) await db.query('CREATE POLICY "'+p.policyname+'" ON public.registro_asistencia AS '+p.permissive+' FOR '+p.cmd+' TO '+p.roles.join(',')+(p.qual?' USING ('+p.qual+')':'')+(p.with_check?' WITH CHECK ('+p.with_check+')':''));
    await db.query("SET LOCAL signum.employee_design='DBREAL_ROLLBACK_ONLY'");
    await db.query(await readFile(new URL('../../database/live-schema/proposals/employee_web_clock_candidate.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/live-schema/proposals/web_clock_canonical_source_delta.sql',import.meta.url),'utf8'));


    catalogBefore=await catalog()
  try{
    await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'")
    const snapshots=JSON.parse(await readFile('C:/Users/Edgar/Desktop/full_catalog_security.txt','utf8'))[0].full_production_catalog_snapshot
    const names=['trg_guard_active_schedule_employee','apply_schedule_catalog_revision','archive_schedule','apply_employee_schedule_lifecycle','assert_schedule_start_not_elapsed','trg_guard_same_day_schedule_assignment','trg_attach_schedule_revision','guard_archived_schedule_assignment']
    await t.test('installed function bodies/modes/paths match supplied production catalog',async()=>{
      const body=d=>d.slice(d.indexOf('AS $')).replace(/\r\n/g,'\n').trim()
      for(const name of names){
        const live=snapshots.sections.routines.find(r=>r.name===name)
        assert.ok(live,name)
        const local=(await db.query("select pg_get_functiondef(oid) definition,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name])).rows
        assert.equal(local.length,1,name)
        assert.equal(body(local[0].definition),body(live.definition),name+' body')
        assert.equal(local[0].prosecdef,live.security==='DEFINER',name+' mode')
        assert.deepEqual(local[0].proconfig,live.config,name+' path')
      }
    })
    const dates=(await db.query("select (clock_timestamp() at time zone 'America/Cancun')::date::text today,((clock_timestamp() at time zone 'America/Cancun')::date+1)::text tomorrow,((clock_timestamp() at time zone 'America/Cancun')::date+2)::text later,(clock_timestamp() at time zone 'America/Cancun')::time::text local_time")).rows[0]
    assert.ok(dates.local_time<'23:58','same-day test requires an unelapsed minute; never skip')
    const company=async()=>(await db.query("insert into public.clientes(nombre_empresa) values('Horarios closure fixture') returning id")).rows[0].id
    const a=await company(),b=await company(),actors={}
    for(const [name,role,company,status]of [['admin','admin',a,'activo'],['rh','rh',a,'activo'],['central','superadmin',b,'activo'],['foreign','admin',b,'activo'],['suspended','admin',a,'suspendido'],['employee','colaborador',a,'activo']]){
      const id=randomUUID()
      await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')",[id,id+'@example.invalid'])
      await db.query('insert into public.usuarios_perfiles(id,cliente_id,nombre,rol,estatus_cuenta) values($1,$2,$3,$4,$5)',[id,company,'Closure fixture',role,status])
      actors[name]=id
    }
    const employee=async(company,active=true)=>(await db.query("insert into public.empleados(cliente_id,nombre,apellido,device_userid,activo) values($1,'Closure','Fixture',$2,$3) returning id",[company,randomUUID(),active])).rows[0].id
    const e=await employee(a),inactive=await employee(a,false),foreign=await employee(b),sameDay=await employee(a)
    const snapshot=(entry='23:59')=>({calculation_contract_version:1,horario_activo:true,tolerancia_minutos:10,dias_config:Object.fromEntries(['lun','mar','mie','jue','vie','sab','dom'].map(k=>[k,{activo:true,entrada:entry,salida:'06:00',descanso_inicio:'',descanso_fin:''}]))})
    async function actor(name,sql,args=[]){
      await db.query('SAVEPOINT actor_call')
      try{
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actors[name]])
        await db.query('SET LOCAL ROLE authenticated')
        const r=await db.query(sql,args)
        await db.query('RESET ROLE');await db.query('RELEASE SAVEPOINT actor_call');return r
      }catch(e){await db.query('ROLLBACK TO SAVEPOINT actor_call');await db.query('RELEASE SAVEPOINT actor_call');throw e}
    }
    const create=async(name='admin',date=dates.tomorrow,entry='23:59')=>(await actor(name,"select public.apply_schedule_catalog_revision($1,'CREATE',NULL,'Closure fixture',NULL,NULL,$2,$3,'closure test',$4) result",[a,JSON.stringify(snapshot(entry)),date,randomUUID()])).rows[0].result
    const assign=async(emp,id,date=dates.tomorrow,name='admin')=>(await actor(name,"select public.apply_employee_schedule_lifecycle($1,$2::uuid[],'ASSIGN_OR_REPLACE',$3,$4,NULL,NULL,'closure assign',$5,false,false) result",[a,[emp],id,date,randomUUID()])).rows[0].result
    const archive=async(id,name='admin')=>(await actor(name,"select public.archive_schedule($1,'closure archive',$2) result",[id,randomUUID()])).rows[0].result
    const revisions=async(id)=>(await db.query('select to_jsonb(r) data from public.schedule_revisions r where horario_id=$1 order by version',[id])).rows.map(r=>r.data)
    let future,today,otherToday,assignment
    await t.test('create future schedule atomically with revision and company folio',async()=>{
      future=await create('rh')
      assert.equal(future.revision_version,1)
      assert.equal((await revisions(future.schedule_id)).length,1)
      assert.ok((await db.query('select folio from public.horarios where id=$1',[future.schedule_id])).rows[0].folio)
    })
    await t.test('edit creates immutable next revision and preserves original calculation configuration',async()=>{
      const before=await revisions(future.schedule_id)
      const r=await actor('rh',"select public.apply_schedule_catalog_revision($1,'REVISE',$2,'Revised fixture',NULL,NULL,$3,$4,'closure revision',$5) result",[a,future.schedule_id,JSON.stringify(snapshot('23:58')),dates.later,randomUUID()])
      assert.equal(r.rows[0].result.revision_version,2)
      assert.deepEqual((await revisions(future.schedule_id))[0],before[0])
    })
    await t.test('assign attaches the applicable immutable revision; active archive denied',async()=>{
      const r=await assign(e,future.schedule_id)
      assignment=r.results[0].assignment_id
      assert.equal((await db.query('select schedule_revision_id from public.empleados_horarios where id=$1',[assignment])).rows[0].schedule_revision_id,future.revision_id)
      await assert.rejects(archive(future.schedule_id),/SCHEDULE_DELETE_HAS_ACTIVE_ASSIGNMENTS/)
    })
    await t.test('inactive employee and employee from another company rejected',async()=>{
      await assert.rejects(assign(inactive,future.schedule_id),/SCHEDULE_EMPLOYEE_INACTIVE_OR_TENANT_MISMATCH/)
      await assert.rejects(assign(foreign,future.schedule_id),/SCHEDULE_LIFECYCLE_EMPLOYEE_TENANT_MISMATCH/)
    })
    await t.test('same-day creation and assignment before entry; elapsed entry rejected',async()=>{
      today=await create('admin',dates.today)
      otherToday=await create('admin',dates.today)
      await assign(sameDay,today.schedule_id,dates.today)
      await assert.rejects(create('admin',dates.today,'00:00'),/SCHEDULE_START_ALREADY_ELAPSED/)
      await assert.rejects(actor('admin',"select public.apply_schedule_catalog_revision($1,'REVISE',$2,'Today',NULL,NULL,$3,$4,'not allowed',$5)",[a,today.schedule_id,JSON.stringify(snapshot()),dates.today,randomUUID()]),/SCHEDULE_CATALOG_INVALID_ARGUMENTS/)
    })
    await t.test('122 same-start replacement preserves the previous assignment row and revisions',async()=>{
      const before=(await db.query('select * from public.empleados_horarios where empleado_id=$1',[sameDay])).rows[0]
      const immutable=await revisions(today.schedule_id)
      await assign(sameDay,otherToday.schedule_id,dates.today)
      const rows=(await db.query('select * from public.empleados_horarios where empleado_id=$1',[sameDay])).rows
      assert.equal(rows.length,2)
      assert.equal(rows.find(r=>r.id===before.id).activo,false)
      assert.equal(rows.find(r=>r.activo).horario_id,otherToday.schedule_id)
      assert.deepEqual(await revisions(today.schedule_id),immutable)
    })
    await t.test('archive retains old assignment and revisions, is idempotent; archived edit denied',async()=>{
      const before=await revisions(today.schedule_id)
      assert.equal((await archive(today.schedule_id)).result,'ARCHIVED')
      assert.equal((await archive(today.schedule_id)).result,'UNCHANGED')
      assert.deepEqual(await revisions(today.schedule_id),before)
      assert.equal((await db.query('select count(*)::int n from public.empleados_horarios where horario_id=$1',[today.schedule_id])).rows[0].n,1)
      await assert.rejects(actor('admin',"select public.apply_schedule_catalog_revision($1,'REVISE',$2,'Archived',NULL,NULL,$3,$4,'closure deny',$5)",[a,today.schedule_id,JSON.stringify(snapshot()),dates.tomorrow,randomUUID()]),/SCHEDULE_ARCHIVED_READ_ONLY/)
    })
    await t.test('permissions preserve RH editing and restrict archive, foreign users and suspended accounts',async()=>{
      await assert.rejects(archive(otherToday.schedule_id,'rh'),/SCHEDULE_DELETE_FORBIDDEN/)
      await assert.rejects(create('foreign'),/SCHEDULE_CATALOG_FORBIDDEN/)
      await assert.rejects(create('suspended'),/SCHEDULE_CATALOG_FORBIDDEN/)
      await assert.rejects(create('employee'),/SCHEDULE_CATALOG_FORBIDDEN/)
      const central=await create('central')
      assert.equal((await archive(central.schedule_id,'central')).result,'ARCHIVED')
      const foreignVisible=await actor('foreign','select id from public.horarios where cliente_id=$1',[a])
      assert.equal(foreignVisible.rowCount,0)
    })
    await t.test('no Attendance, Workday, gates, device data or catalog modification',async()=>{
      assert.deepEqual(await data(protectedTables),protectedBefore)
      assert.deepEqual(await catalog(),catalogBefore)
    })
  }finally{
    await db.query('ROLLBACK')
    try{await t.test('all public data and catalog restored exactly after rollback',async()=>{
      assert.deepEqual(await data(tables),original)
      assert.deepEqual(await catalog(),originalCatalog)
    })}finally{await db.end()}
  }
})
