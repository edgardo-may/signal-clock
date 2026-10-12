import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import pg from 'pg'

// Hardcoded loopback: this test never reads production credentials.
const connectionString='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
test('Candidate DBREAL biometric regression: known production body fixture; no replay',async t=>{
  const db=new pg.Client({connectionString})
  await db.connect()
  const tables=['attendance_logs','attendance_source_events','registro_asistencia','devices','device_commands','empleados','device_employee_assignments','workday_records','workday_record_history','workday_calculation_revisions','workday_revision_promotions','attendance_persist_outbox','tenant_features']
  const snapshot=async()=>{
    const rows={}
    for(const table of tables) rows[table]=(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) digest FROM public.${table} x`)).rows[0].digest
    rows.definition=(await db.query("SELECT pg_get_functiondef('public.fn_sync_attendance_to_registro()'::regprocedure) definition")).rows[0].definition
    return rows
  }
  const before=await snapshot()
  await db.query('BEGIN')
  try {

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


    // Known production body, reconstructed only as a disposable transaction
    // fixture. No historical migration replay and no production access.
    const routine=live.sections.routines.find(r=>r.name==='fn_sync_attendance_to_registro');
    assert.ok(routine?.definition);
    await db.query(routine.definition);
    const baseline=(await db.query("SELECT pg_get_functiondef('public.fn_sync_attendance_to_registro()'::regprocedure) definition")).rows[0].definition;
    await t.test('I01 known production trigger body preserved under candidate',async()=>{
      assert.equal((await db.query("SELECT pg_get_functiondef('public.fn_sync_attendance_to_registro()'::regprocedure) definition")).rows[0].definition,baseline);
    });
    const suffix=randomUUID().slice(0,8).toUpperCase(),key='91812',pin='1'
    const tenant=async name=>(await db.query('INSERT INTO public.clientes(nombre_empresa) VALUES($1) RETURNING id',[name])).rows[0].id
    const a=await tenant('Identity fixture LG'),b=await tenant('Identity fixture SURCACEN')
    const employee=async(tenantId,clave,userid)=>(await db.query("INSERT INTO public.empleados(cliente_id,nombre,apellido,clave_empleado,device_userid,activo) VALUES($1,'Identity','Fixture',$2,$3,true) RETURNING id",[tenantId,clave,userid])).rows[0].id
    const wrong=await employee(a,key,`lg-${suffix}`),right=await employee(b,key,pin)
    const device=(await db.query("INSERT INTO public.devices(cliente_id,serial_number,name,is_active,timezone) VALUES($1,$2,'Identity fixture',true,'America/Cancun') RETURNING id,serial_number",[b,`ID-${suffix}`])).rows[0]
    const assignment=(await db.query("INSERT INTO public.device_employee_assignments(cliente_id,device_id,employee_id,biometric_user_id,activo,sync_status) VALUES($1,$2,$3,$4,true,'SYNCED') RETURNING id",[b,device.id,right,pin])).rows[0].id
    let seq=0
    const punch=async(raw='0',user=key,serial=device.serial_number)=>{
      const timestamp=new Date(Date.UTC(2030,5,10,14,seq++))
      const log=(await db.query("INSERT INTO public.attendance_logs(device_serial,user_id,timestamp,status,verify_type,metodo) VALUES($1,$2,$3,$4,1,'huella') RETURNING id",[serial,user,timestamp,raw])).rows[0]
      const rows=(await db.query("SELECT * FROM public.registro_asistencia WHERE raw_payload->>'source_log_id'=$1",[log.id])).rows
      assert.equal(rows.length,1)
      assert.equal(rows[0].cliente_id,b);assert.equal(rows[0].empleado_id,right);assert.equal(rows[0].dispositivo_id,device.id)
      assert.equal(rows[0].raw_payload.raw_status,raw)
      return {row:rows[0],log}
    }
    const scenario=async(name,fn)=>t.test(name,async()=>{
      await db.query('SAVEPOINT scenario')
      try{await fn()}finally{await db.query('ROLLBACK TO SAVEPOINT scenario');await db.query('RELEASE SAVEPOINT scenario')}
    })
    await scenario('I02 duplicated employee key across tenants resolves exclusively to device tenant',async()=>{
      const {row}=await punch();assert.notEqual(row.empleado_id,wrong);assert.equal(row.tipo_verificacion,'entrada')
      assert.equal(+(await db.query('SELECT count(*) n FROM public.registro_asistencia WHERE empleado_id=$1',[wrong])).rows[0].n,0)
    })
    await scenario('I03 original terminal PIN resolves through active assignment',async()=>{await punch('0',pin)})
    await scenario('I04 unassigned identity rejects atomically',async()=>{
      await db.query('UPDATE public.device_employee_assignments SET activo=false WHERE id=$1',[assignment])
      await assert.rejects(()=>punch(),/ATTENDANCE_DEVICE_EMPLOYEE_NOT_AUTHORIZED/)
    })
    await scenario('I05 inactive employee rejected',async()=>{
      await db.query('UPDATE public.empleados SET activo=false WHERE id=$1',[right])
      await assert.rejects(()=>punch(),/ATTENDANCE_DEVICE_EMPLOYEE_NOT_AUTHORIZED/)
    })
    await scenario('I06 inactive device rejected',async()=>{
      await db.query('UPDATE public.devices SET is_active=false WHERE id=$1',[device.id])
      await assert.rejects(()=>punch(),/ATTENDANCE_DEVICE_NOT_AUTHORIZED/)
    })
    await scenario('I07 employee key from another tenant cannot resolve',async()=>{
      await assert.rejects(()=>punch('0',`lg-${suffix}`),/ATTENDANCE_DEVICE_EMPLOYEE_NOT_AUTHORIZED/)
    })
    await scenario('I08 conflicting key and PIN inside same tenant rejected instead of LIMIT 1',async()=>{
      const other=await employee(b,`other-${suffix}`,key)
      await db.query("INSERT INTO public.device_employee_assignments(cliente_id,device_id,employee_id,biometric_user_id,activo,sync_status) VALUES($1,$2,$3,$4,true,'SYNCED')",[b,device.id,other,'3'])
      await assert.rejects(()=>punch(),/ATTENDANCE_DEVICE_EMPLOYEE_AMBIGUOUS/)
    })
    await scenario('I09 explicit IN/OUT and AUTO cycle remain deterministic',async()=>{
      assert.equal((await punch('0')).row.tipo_verificacion,'entrada')
      assert.equal((await punch('255')).row.tipo_verificacion,'salida')
      assert.equal((await punch('255')).row.tipo_verificacion,'entrada')
      assert.equal((await punch('1')).row.tipo_verificacion,'salida')
      for(const [raw,direction] of [['2','descanso_inicio'],['3','descanso_fin'],['4','inicio_extra'],['5','fin_extra']]) assert.equal((await punch(raw)).row.tipo_verificacion,direction)
    })
    await scenario('I10 canonical source link succeeds with gate OFF; no persistence outbox',async()=>{
      const {row,log}=await punch()
      const source=(await db.query("INSERT INTO public.attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,occurred_at,raw_payload) VALUES($1,$2,$3,'ZKTECO',$4,$5,'{}') RETURNING id",[b,right,device.id,log.id,row.verificado_at])).rows[0].id
      await db.query('SELECT * FROM public.link_attendance_source_event($1)',[source])
      assert.equal((await db.query('SELECT processing_status FROM public.attendance_source_events WHERE id=$1',[source])).rows[0].processing_status,'PROCESSED')
      assert.equal((await db.query('SELECT source_event_id FROM public.registro_asistencia WHERE id=$1',[row.id])).rows[0].source_event_id,source)
      assert.equal(+(await db.query('SELECT count(*) n FROM public.attendance_persist_outbox WHERE registro_id=$1',[row.id])).rows[0].n,0)
    })
    await scenario('I11 AUTO outside 18 hours starts a new cycle',async()=>{
      const {row}=await punch('0')
      // Advance event-time, without changing the function or any clock.
      await db.query("UPDATE public.registro_asistencia SET verificado_at=verificado_at-interval '19 hours' WHERE id=$1",[row.id])
      assert.equal((await punch('255')).row.tipo_verificacion,'entrada')
    })
    await scenario('I13 physical ZKTECO remains canonical with productive gate ON',async()=>{
      await db.query("insert into tenant_features(cliente_id,feature_key,mode,enabled) values($1,'WORKDAY_PERSIST_ACTIVE','PERSIST_ACTIVE',true) on conflict(cliente_id,feature_key) do update set mode='PERSIST_ACTIVE',enabled=true",[b])
      const {row,log}=await punch()
      const source=(await db.query("INSERT INTO public.attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,occurred_at,raw_payload) VALUES($1,$2,$3,'ZKTECO',$4,$5,'{}') RETURNING id",[b,right,device.id,log.id,row.verificado_at])).rows[0].id
      await db.query('SELECT * FROM public.link_attendance_source_event($1)',[source])
      assert.equal(+(await db.query('SELECT count(*) n FROM public.attendance_persist_outbox WHERE registro_id=$1',[row.id])).rows[0].n,1)
    })
    await scenario('I12 AUTO rejects reverse arrival atomically',async()=>{
      const {row}=await punch('0')
      await db.query("UPDATE public.registro_asistencia SET verificado_at=verificado_at+interval '1 day' WHERE id=$1",[row.id])
      await assert.rejects(()=>punch('255'),/AUTO_CYCLE_OUT_OF_ORDER/)
    })
  } finally {
    await db.query('ROLLBACK')
    try{assert.deepEqual(await snapshot(),before,'No historical data, fixtures, function or Workday changes survive rollback')}finally{await db.end()}
  }
})
