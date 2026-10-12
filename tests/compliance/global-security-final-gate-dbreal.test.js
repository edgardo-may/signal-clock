import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

// Deliberately strict acceptance gate. Known unfixed risks must FAIL, never skip.
test('GLOBAL SECURITY closure gate against known production contracts + frozen base + employee delta',async t=>{
  const db=new pg.Client({connectionString:'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres',connectionTimeoutMillis:5000});
  await db.connect();
  const digest=async()=>{
    const out={};
    for(const {relname} of (await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows)
      out[relname]=(await db.query(`select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) digest from public."${relname.replaceAll('"','""')}" x`)).rows[0].digest;
    return out;
  };
  const before=await digest();
  await db.query('BEGIN');
  try{
    const live=JSON.parse(await readFile('C:/Users/Edgar/Desktop/full_catalog_security.txt','utf8'))[0].full_production_catalog_snapshot;
    for(const name of ['fn_employee_insert_sync','fn_generar_faltas_diarias','fn_registrar_asistencia_colaborador','fn_login_colaborador']){
      await db.query(live.sections.routines.find(r=>r.name===name).definition);
    }
    await db.query('GRANT EXECUTE ON FUNCTION public.fn_registrar_asistencia_colaborador(uuid,uuid,text,timestamptz,jsonb) TO PUBLIC,anon,authenticated,service_role');
    // Reproduce only the already demonstrated six attendance policies.
    for(const {policyname} of (await db.query("select policyname from pg_policies where schemaname='public' and tablename='registro_asistencia'")).rows)
      await db.query(`DROP POLICY "${policyname.replaceAll('"','""')}" ON public.registro_asistencia`);
    for(const p of live.sections.policies.filter(p=>p.tablename==='registro_asistencia')){
      await db.query(`CREATE POLICY "${p.policyname}" ON public.registro_asistencia AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''}`);
    }
    await db.query('GRANT SELECT,INSERT ON public.registro_asistencia TO anon,authenticated');
    await db.query("SET LOCAL signum.hardening_design='DBREAL_ROLLBACK_ONLY'");
    await db.query(await readFile(new URL('../../database/live-schema/proposals/global_security_minimum_candidate.sql',import.meta.url),'utf8'));
    await db.query("SET LOCAL signum.employee_design='DBREAL_ROLLBACK_ONLY'");
    await db.query(await readFile(new URL('../../database/live-schema/proposals/employee_web_clock_candidate.sql',import.meta.url),'utf8'));
    await db.query(await readFile(new URL('../../database/live-schema/proposals/web_clock_canonical_source_delta.sql',import.meta.url),'utf8'));
    const company=async()=>(await db.query("insert into public.clientes(nombre_empresa) values('Closure gate disposable') returning id")).rows[0].id;
    const a=await company(),b=await company();
    const emp=(await db.query("insert into public.empleados(cliente_id,nombre,apellido,device_userid,activo) values($1,'Gate','Fixture',$2,true) returning id",[a,randomUUID()])).rows[0].id;
    const row=(await db.query("insert into public.registro_asistencia(cliente_id,empleado_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload) values($1,$2,clock_timestamp(),'entrada','web',false,'{}') returning id",[a,emp])).rows[0].id;
    const actor=randomUUID();
    await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')",[actor,actor+'@example.invalid']);
    await db.query("insert into public.usuarios_perfiles(id,cliente_id,nombre,rol,estatus_cuenta) values($1,$2,'Gate fixture','admin','activo')",[actor,b]);
    async function asRole(role,sql,args=[]){
      await db.query('SAVEPOINT gate_probe');
      try{
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
        await db.query(`SET LOCAL ROLE ${role}`);
        return await db.query(sql,args);
      }finally{await db.query('ROLLBACK TO SAVEPOINT gate_probe');await db.query('RELEASE SAVEPOINT gate_probe');}
    }
    await t.test('anon MUST be denied employee write RPC before entering body',async()=>{
      // Nonexistent employee: even if unsafe body executes, this creates no punch.
      await assert.rejects(asRole('anon','select public.fn_registrar_asistencia_colaborador($1,$2,$3)',[a,randomUUID(),'entrada']),e=>e.code==='42501');
    });
    await t.test('anon MUST NOT read attendance without a server credential',async()=>{
      await assert.rejects(asRole('anon','select id from public.registro_asistencia where id=$1',[row]),e=>e.code==='42501');
    });
    await t.test('authenticated admin of Empresa B MUST NOT read attendance of A',async()=>{
      assert.equal((await asRole('authenticated','select id from public.registro_asistencia where id=$1',[row])).rowCount,0);
    });
  }finally{
    await db.query('ROLLBACK');
    try{await t.test('all pre-existing public rows restored after failed acceptance gate',async()=>assert.deepEqual(await digest(),before));}
    finally{await db.end();}
  }
});
