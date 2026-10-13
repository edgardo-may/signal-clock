import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {auditConfig} from '../helpers/testDb.js';
import {createRequire} from 'node:module';
import {canonicalSqlTransport} from '../helpers/canonicalSqlTransport.js';
const require=createRequire(import.meta.url);
const {loadPersistAuthorization}=require('../../backend/attendance-runtime-v3/tenantPersistence.js');
const {AttendanceRuntimeService}=require('../../backend/attendance-runtime-v3/AttendanceRuntimeService.js');

const hash=v=>createHash('sha256').update(v).digest('hex');
test('Employee candidate: local DBREAL only, transactional restoration',async t=>{
 const config=auditConfig();
 assert.ok(config.ready,'Explicit approved local DBREAL configuration required');
 const db=new pg.Client({connectionString:config.adminDbUrl,connectionTimeoutMillis:5000});
 await db.connect();
 const rows=async()=>{
  const out={};
  for(const {name} of (await db.query("select quote_ident(relname) name from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows)
   out[name]=(await db.query(`select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by to_jsonb(r)::text),'')) digest from public.${name} r`)).rows[0].digest;
  return out;
 };
 const catalog=async()=>(await db.query(`select
  (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public') policies,
  (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'acl',proacl,'def',pg_get_functiondef(oid)) order by oid::regprocedure::text) from pg_proc where pronamespace='public'::regnamespace and prokind='f') functions,
  (select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace) relations,
  (select jsonb_agg(to_jsonb(a) order by attrelid,attnum) from pg_attribute a where attrelid in(select oid from pg_class where relnamespace='public'::regnamespace)) columns,
  (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d) defaults,
  (select jsonb_agg(to_jsonb(tr) order by oid) from pg_trigger tr where tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace)) triggers
 `)).rows[0];
 const before=await rows(),beforeCatalog=await catalog();
 await db.query('BEGIN');
 try{
  const live=JSON.parse(await readFile('C:/Users/Edgar/Desktop/full_catalog_security.txt','utf8'))[0].full_production_catalog_snapshot;
  for(const name of ['fn_login_colaborador','fn_registrar_asistencia_colaborador','trg_audit_empleados']) await db.query(live.sections.routines.find(r=>r.name===name).definition);
  for(const {policyname} of (await db.query("select policyname from pg_policies where schemaname='public' and tablename='registro_asistencia'")).rows) await db.query(`DROP POLICY "${policyname.replaceAll('"','""')}" ON public.registro_asistencia`);
  for(const p of live.sections.policies.filter(p=>p.tablename==='registro_asistencia')) await db.query(`CREATE POLICY "${p.policyname}" ON public.registro_asistencia AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''}`);
  const legacyCompany=(await db.query("insert into clientes(nombre_empresa) values('Legacy credential rollback fixture') returning id")).rows[0].id;
  const legacyEmployee=(await db.query("insert into empleados(cliente_id,nombre,apellido,device_userid,clave_empleado,pin,activo) values($1,'Legacy','Fixture',$2,'LEGACY','54321',true) returning id",[legacyCompany,randomUUID()])).rows[0].id;
  const installationBaseline=await rows();
  await db.query("SET LOCAL signum.employee_design='DBREAL_ROLLBACK_ONLY'");
  await db.query(await readFile(new URL('../../database/live-schema/proposals/employee_web_clock_candidate.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/live-schema/proposals/web_clock_canonical_source_delta.sql',import.meta.url),'utf8'));
  await t.test('installation changes zero business rows',async()=>assert.deepEqual(await rows(),installationBaseline));
  await t.test('separate scoped legacy credential conversion hashes and removes plaintext',async()=>{
   await db.query("select set_config('signum.employee_company',$1,true)",[legacyCompany]);
   await db.query(await readFile(new URL('../../database/live-schema/proposals/employee_pin_conversion_candidate.sql',import.meta.url),'utf8'));
   assert.equal((await db.query('select pin from empleados where id=$1',[legacyEmployee])).rows[0].pin,null);
   assert.equal((await db.query("select pin_hash=extensions.crypt('54321',pin_hash) valid from employee_private.credentials where empleado_id=$1",[legacyEmployee])).rows[0].valid,true);
  });
  const company=async()=>(await db.query("insert into clientes(nombre_empresa) values('Employee rollback fixture') returning id")).rows[0].id;
  const a=await company(),b=await company();
  const emp=async(company,key,pin='12345')=>(await db.query("insert into empleados(cliente_id,nombre,apellido,device_userid,clave_empleado,pin,activo) values($1,'Secure','Fixture',$2,$3,$4,true) returning id",[company,randomUUID(),key,pin])).rows[0].id;
  const e=await emp(a,'SECURE'),other=await emp(a,'OTHER'),foreign=await emp(b,'FOREIGN');
  const actor=randomUUID();
  await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')",[actor,actor+'@example.invalid']);
  await db.query("insert into usuarios_perfiles(id,cliente_id,nombre,rol,estatus_cuenta) values($1,$2,'Fixture','superadmin','activo')",[actor,a]);
  async function role(role,sql,args=[],uid=actor){
   await db.query('SAVEPOINT role_test');
   try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.query(`SET LOCAL ROLE ${role}`);return await db.query(sql,args);}
   finally{await db.query('ROLLBACK TO SAVEPOINT role_test');await db.query('RELEASE SAVEPOINT role_test');}
  }
  const manage=async(action,input)=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return (await db.query('select manage_web_clock($1,$2) result',[action,input])).rows[0].result;};
  await manage('AUTHORIZE',{cliente_id:a,enabled:true});await manage('AUTHORIZE',{cliente_id:b,enabled:true});
  await manage('TERMINAL',{cliente_id:a,slug:'secure-cancun',name:'Cancún',location:'Cancún',timezone:'America/Cancun'});
  await manage('TERMINAL',{cliente_id:a,slug:'secure-merida',name:'Mérida',location:'Mérida',timezone:'America/Merida'});
  await manage('TERMINAL',{cliente_id:b,slug:'foreign-clock',name:'Foreign',timezone:'UTC'});
  const localDay=new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'America/Cancun'}).format(new Date()).toLowerCase();
  const activeDay=({sun:'dom',mon:'lun',tue:'mar',wed:'mie',thu:'jue',fri:'vie',sat:'sab'})[localDay];
  const dayConfig=Object.fromEntries(['dom','lun','mar','mie','jue','vie','sab'].map(k=>[k,{activo:k===activeDay,entrada:'00:00',salida:'23:59',tiene_descanso:false}]));
  const schedule=(await db.query("insert into horarios(cliente_id,nombre,dias_config,tolerancia_minutos,activo) values($1,'WEB canonical fixture',$2,10,true) returning id",[a,dayConfig])).rows[0].id;
  const snapshot={calculation_contract_version:1,dias_config:dayConfig,tolerancia_minutos:10,horario_activo:true};
  const revision=(await db.query("insert into schedule_revisions(cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,reason) values($1,$2,1,current_date-2,$3,public.schedule_revision_calculation_hash($3),'WEB_CANONICAL_FIXTURE') returning id",[a,schedule,snapshot])).rows[0].id;
  await db.query('insert into empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,activo,schedule_revision_id) values($1,$2,$3,current_date-2,true,$4)',[a,other,schedule,revision]);
  const call=async(action,input)=>(await db.query('select fn_employee_portal($1,$2) result',[action,input])).rows[0].result;
  const token=hash(randomUUID()),otherToken=hash(randomUUID());
  const login=(overrides={})=>call('LOGIN',{cliente_id:a,clave:'SECURE',pin:'12345',token_hash:hash(randomUUID()),source_hash:hash('local'),clock_slug:'secure-cancun',...overrides});
  await t.test('PIN captured as hash, not returned or audited',async()=>{
   assert.equal((await db.query('select pin from empleados where id=$1',[e])).rows[0].pin,null);
   const credential=(await db.query('select pin_hash from employee_private.credentials where empleado_id=$1',[e])).rows[0].pin_hash;
   assert.ok(credential.startsWith('$2'));assert.ok(!JSON.stringify((await db.query('select * from audit_logs where resource_id=$1',[e])).rows).includes('12345'));
  });
  await t.test('legitimate login and verified state',async()=>{
   const result=await login({token_hash:token});assert.equal(result.success,true);assert.equal(result.session.empleadoId,e);assert.ok(!JSON.stringify(result).includes('12345'));assert.ok(!JSON.stringify(result).includes(token));
   assert.equal((await call('STATE',{token_hash:token,clock_slug:'secure-cancun'})).success,true);
  });
  await t.test('wrong PIN denied',async()=>assert.equal((await login({pin:'99999'})).success,false));
  await t.test('wrong Empresa denied',async()=>assert.equal((await login({cliente_id:b})).success,false));
  await t.test('inactive employee denied',async()=>{await db.query('update empleados set activo=false where id=$1',[e]);assert.equal((await login()).success,false);await db.query('update empleados set activo=true where id=$1',[e]);});
  await t.test('tampered token denied',async()=>assert.equal((await call('STATE',{token_hash:hash('tampered')})).success,false));
  await t.test('browser IDs cannot change session employee or Empresa',async()=>{
   for(const ids of [{empleado_id:other},{employee_id:foreign},{cliente_id:b}]) assert.equal((await call('STATE',{token_hash:token,...ids})).success,false);
  });
  await t.test('foreign terminal denied',async()=>assert.equal((await call('STATE',{token_hash:token,clock_slug:'foreign-clock'})).success,false));
  await t.test('multiple authorized terminals in own Empresa',async()=>assert.equal((await call('STATE',{token_hash:token})).clocks.length,2));
  const request=randomUUID();
  const punch=(overrides={})=>call('PUNCH',{token_hash:token,clock_slug:'secure-cancun',request_id:request,direction:'entrada',evidence:{ubicacion_gps:{latitud:21,longitud:-86,precision_metros:10}},...overrides});
  await t.test('own WEB_CLOCK punch and server timestamp',async()=>{
   const start=Date.now(),result=await punch({verificado_at:'2001-01-01T00:00:00Z'});assert.equal(result.success,true);assert.ok(new Date(result.registro.verificado_at).getTime()>=start-1000);
   const source=(await db.query('select * from attendance_source_events where id=$1',[result.registro.source_event_id])).rows[0];assert.equal(source.source_type,'WEB');assert.equal(source.raw_payload.source,'WEB_CLOCK');assert.equal(source.employee_id,e);
  });
  await t.test('idempotent retry creates exactly one punch',async()=>{const result=await punch();assert.equal(result.success,true);assert.equal((await db.query('select count(*)::int n from attendance_source_events where request_id=$1',[request])).rows[0].n,1);});
  await t.test('invalid direction denied server-side',async()=>assert.equal((await punch({request_id:randomUUID()})).success,false));
  await t.test('own attendance only',async()=>{
   await call('LOGIN',{cliente_id:a,clave:'OTHER',pin:'12345',token_hash:otherToken,source_hash:hash('other'),clock_slug:'secure-cancun'});
   const result=await call('STATE',{token_hash:otherToken,clock_slug:'secure-cancun'});assert.equal(result.success,true);assert.equal(result.attendance.length,0);
  });
  await t.test('two employees share one terminal; same employee uses own second terminal',async()=>{
   const second=await call('PUNCH',{token_hash:otherToken,clock_slug:'secure-cancun',request_id:randomUUID(),direction:'entrada',evidence:{}});
   assert.equal(second.success,true);
   const exit=await punch({clock_slug:'secure-merida',request_id:randomUUID(),direction:'salida'});assert.equal(exit.success,true);
   const devices=(await db.query('select empleado_id,dispositivo_id from registro_asistencia where id=any($1::uuid[])',[[second.registro.id,(await punch()).registro.id]])).rows;
   assert.equal(devices[0].dispositivo_id,devices[1].dispositivo_id);
  });
  await t.test('WEB_CLOCK must enter productive outbox with existing gate active',async pipelineTest=>{
   await db.query('SAVEPOINT pipeline_acceptance');
   try{
    // Reproduce the supplied productive body only in this rollback fixture.
    // Final candidate guard already installed; do not overwrite it with old body.
    await db.query("insert into tenant_features(cliente_id,feature_key,mode,enabled) values($1,'WORKDAY_PERSIST_ACTIVE','PERSIST_ACTIVE',true) on conflict(cliente_id,feature_key) do update set mode='PERSIST_ACTIVE',enabled=true",[a]);
    const result=await call('PUNCH',{token_hash:otherToken,clock_slug:'secure-cancun',request_id:randomUUID(),direction:'salida',evidence:{}});
    assert.equal(result.success,true);
    assert.equal((await db.query('select count(*)::int n from attendance_persist_outbox where registro_id=$1',[result.registro.id])).rows[0].n,1);
    const registroId=result.registro.id,sourceId=result.registro.source_event_id;
    const client=canonicalSqlTransport(db);
    const authorize=()=>loadPersistAuthorization(client,{tenantId:a,employeeId:other,registroId,sourceEventId:sourceId});
    await db.query('SET LOCAL ROLE service_role');
    try{assert.equal((await authorize()).registroId,registroId);}finally{await db.query('RESET ROLE');}
    await db.query('CREATE TEMP TABLE canonical_guard_probe (LIKE public.registro_asistencia)');
    await db.query('CREATE TRIGGER canonical_guard_probe AFTER INSERT ON canonical_guard_probe FOR EACH ROW EXECUTE FUNCTION public.enqueue_attendance_persist_outbox()');
    await pipelineTest.test('raw WEB_CLOCK label cannot create productive attendance without receipt',async()=>{
     await db.query('SAVEPOINT fabricated_source');
     try{
      const id=randomUUID();
      const fake=(await db.query("insert into attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,request_id,occurred_at,raw_payload,processing_status) select cliente_id,employee_id,device_id,'WEB',$1,$1,occurred_at,raw_payload,'PROCESSED' from attendance_source_events where id=$2 returning id",[id,sourceId])).rows[0].id;
      await assert.rejects(db.query("insert into registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,source_event_id,raw_payload) select cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,'web',false,$1,raw_payload from registro_asistencia where id=$2",[fake,registroId]),error=>error.code==='23514'&&error.message==='PRODUCTIVE_PERSIST_CANONICAL_SOURCE_INVALID');
     }finally{await db.query('ROLLBACK TO SAVEPOINT fabricated_source');await db.query('RELEASE SAVEPOINT fabricated_source');}
    });
    for(const [label,sql,args] of [
     ['unprocessed',"update attendance_source_events set processing_status='PENDING' where id=$1",[sourceId]],
     ['foreign employee','update employee_private.web_clock_receipts set empleado_id=$1 where source_event_id=$2',[e,sourceId]],
     ['foreign Empresa','update employee_private.web_clock_receipts set cliente_id=$1 where source_event_id=$2',[b,sourceId]],
     ['inactive terminal',"update employee_private.web_clocks set active=false where slug='secure-cancun'",[]],
     ['inactive device','update devices set is_active=false where id=(select device_id from employee_private.web_clock_receipts where source_event_id=$1)',[sourceId]],
     ['unauthorized Empresa','update employee_private.company_authorizations set enabled=false where cliente_id=$1',[a]],
     ['missing receipt','delete from employee_private.web_clock_receipts where source_event_id=$1',[sourceId]],
     ['fabricated time',"update employee_private.web_clock_receipts set received_at=received_at-interval '1 second' where source_event_id=$1",[sourceId]],
     ['session revoked before receipt',"update employee_private.sessions set revoked_at=(select received_at-interval '1 second' from employee_private.web_clock_receipts where source_event_id=$1) where token_hash=$2",[sourceId,otherToken]],
    ]){
     await pipelineTest.test('DB and runtime deny '+label,async()=>{
      await db.query('SAVEPOINT evidence_probe');
      try{
       await db.query(sql,args);
       assert.equal((await db.query('select is_canonical_web_clock_source($1,$2,$3,$4) valid',[registroId,sourceId,a,other])).rows[0].valid,false);
       await assert.rejects(authorize(),error=>error.code==='PERSIST_SOURCE_EVENT_DENIED');
       await assert.rejects(db.query('insert into canonical_guard_probe select * from registro_asistencia where id=$1',[registroId]),error=>error.code==='23514');
      }finally{await db.query('ROLLBACK TO SAVEPOINT evidence_probe');await db.query('RELEASE SAVEPOINT evidence_probe');}
     });
    }
    await pipelineTest.test('actual runtime -> unchanged orchestrator/calculator -> existing RPC20 -> versioned Workday',async()=>{
     await db.query("insert into tenant_features(cliente_id,feature_key,mode,enabled) values($1,'REVISION_SCHEDULE_RESOLVER','ACTIVE',true) on conflict(cliente_id,feature_key) do update set mode='ACTIVE',enabled=true",[a]);
     await db.query('SET LOCAL ROLE service_role');
     try{
      const runtime=new AttendanceRuntimeService({client,logger:{info(){},error(){}}});
      const first=await runtime.executePersist({registroId});
      assert.equal(first.persistence_result,'INSERTED');
      const second=await runtime.executePersist({registroId});assert.equal(second.persistence_result,'UNCHANGED');
      assert.equal(second.workday_id,first.workday_id);
      assert.equal((await db.query('select count(*)::int n from workday_records where id=$1',[first.workday_id])).rows[0].n,1);
     }finally{await db.query('RESET ROLE');}
    });
   }finally{await db.query('ROLLBACK TO SAVEPOINT pipeline_acceptance');await db.query('RELEASE SAVEPOINT pipeline_acceptance');}
  });
  await t.test('anon old RPC denied before body',async()=>assert.rejects(role('anon','select fn_registrar_asistencia_colaborador($1,$2,$3)',[a,e,'entrada']),err=>err.code==='42501'));
  await t.test('anon direct attendance read denied',async()=>assert.rejects(role('anon','select * from registro_asistencia'),err=>err.code==='42501'));
  await t.test('anon direct insert denied',async()=>assert.rejects(role('anon',"insert into registro_asistencia(cliente_id,empleado_id,tipo_verificacion) values($1,$2,'entrada')",[a,e]),err=>err.code==='42501'));
  await t.test('authenticated cannot call backend session RPC',async()=>assert.rejects(role('authenticated',"select fn_employee_portal('STATE',$1)",[{token_hash:token}]),err=>err.code==='42501'));
  await t.test('browser cannot forge receipt, inspect canonical view or invoke RPC20',async()=>{
   for(const browser of ['anon','authenticated']){
    await assert.rejects(role(browser,'select * from employee_private.web_clock_receipts'),error=>error.code==='42501');
    await assert.rejects(role(browser,'select * from web_clock_canonical_sources'),error=>error.code==='42501');
    await assert.rejects(role(browser,"select * from upsert_workday_record($1,$2,current_date,$3,'UTC',null,null,0,0,0,0,0,'COMPLETE','x',3,$4,clock_timestamp(),1,'{}','{}')",[a,e,schedule,randomUUID()]),error=>error.code==='42501');
   }
  });
  await t.test('cross-Empresa authenticated read denied; own staff read preserved',async()=>{
   await db.query("update usuarios_perfiles set rol='admin',cliente_id=$1 where id=$2",[b,actor]);assert.equal((await role('authenticated','select * from registro_asistencia where empleado_id=$1',[e])).rowCount,0);
   for(const r of ['admin','rh','supervisor']){await db.query('update usuarios_perfiles set rol=$1,cliente_id=$2 where id=$3',[r,a,actor]);assert.equal((await role('authenticated','select * from registro_asistencia where empleado_id=$1',[e])).rowCount,2);}
  });
  await t.test('service_role read preserved',async()=>assert.equal((await role('service_role','select * from registro_asistencia where empleado_id=$1',[e])).rowCount,2));
  await t.test('inactive terminal and revoked capability denied',async()=>{
   await db.query("update employee_private.web_clocks set active=false where slug='secure-cancun'");assert.equal((await punch({request_id:randomUUID(),direction:'salida'})).success,false);
   await db.query("update employee_private.web_clocks set active=true where slug='secure-cancun'");await db.query('update employee_private.company_authorizations set enabled=false where cliente_id=$1',[a]);assert.equal((await punch({request_id:randomUUID(),direction:'salida'})).success,false);
   await db.query('update employee_private.company_authorizations set enabled=true where cliente_id=$1',[a]);
  });
  await t.test('expired and revoked sessions denied',async()=>{
   await db.query("update employee_private.sessions set created_at=created_at-interval '9 hours',expires_at=expires_at-interval '9 hours' where token_hash=$1",[otherToken]);assert.equal((await call('STATE',{token_hash:otherToken})).success,false);
   assert.equal((await call('LOGOUT',{token_hash:token})).success,true);assert.equal((await call('STATE',{token_hash:token})).success,false);
  });
  await t.test('brute force limited per employee, not whole Empresa',async()=>{
   let result;for(let i=0;i<8;i++) result=await login({pin:'99999'});assert.equal(result.rate_limited,true);
   assert.equal((await login({clave:'OTHER'})).success,true);
  });
 }finally{
  await db.query('ROLLBACK');
  try{await t.test('DBREAL data restored',async()=>assert.deepEqual(await rows(),before));await t.test('DBREAL catalog restored',async()=>{assert.deepEqual(await catalog(),beforeCatalog);assert.equal((await db.query("select to_regnamespace('employee_private') missing")).rows[0].missing,null);});}
  finally{await db.end();}
 }
});
