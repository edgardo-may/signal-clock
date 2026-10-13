// Local-only installer. Requires an explicitly approved DBREAL target.
const {Client}=require('pg');
const fs=require('node:fs');
(async()=>{
  const {auditConfig,assertApprovedAuditDatabaseUrl}=await import('../tests/helpers/testDb.js');
  const config=auditConfig();
  if(!config.ready)throw Error('DBREAL_TARGET_NOT_APPROVED');
  assertApprovedAuditDatabaseUrl(config.dbUrl,config);
  const db=new Client({connectionString:config.dbUrl});
  await db.connect();await db.query('BEGIN');
  try{
    const tables=['empleados_horarios','schedule_revisions','horarios','registro_asistencia','attendance_source_events','attendance_persist_outbox','workday_records','workday_record_history','workday_calculation_revisions','workday_revision_promotions','tenant_features'];
    const fingerprint=async()=>{
      const values={};
      for(const table of tables)values[table]=(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) hash FROM public.${table} t`)).rows[0].hash;
      values.persistence=(await db.query("SELECT md5(string_agg(pg_get_functiondef(oid),'|' ORDER BY oid)) hash FROM pg_proc WHERE proname='upsert_workday_record'")).rows[0].hash;
      values.rls=(await db.query("SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'|' ORDER BY to_jsonb(p)::text),'')) hash FROM pg_policies p WHERE schemaname='public'")).rows[0].hash;
      return values;
    };
    const before=await fingerprint();
    const sql=fs.readFileSync('database/live-schema/122_schedule_same_start_date_reassignment.sql','utf8');
    await db.query(sql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
    if(JSON.stringify(await fingerprint())!==JSON.stringify(before))throw Error('Unexpected data, RLS or persistence change; rolled back');
    await db.query('COMMIT');
    console.log('122 installed on local DBREAL only. Data, RLS and persistence RPC fingerprints unchanged.');
  }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
