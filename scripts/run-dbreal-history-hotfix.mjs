import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const url = process.env.PHASE2_AUDIT_DATABASE_URL
if (!url) throw new Error('EXPLICIT_LOCAL_DBREAL_URL_REQUIRED')
const target = new URL(url)
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname))
assert.equal(target.port, '54322')
const db = new pg.Client({ connectionString: url })
const runTests = mode => {
  const result = spawnSync(process.execPath, ['--test', 'tests/compliance/dbreal-history-uniqueness.test.js'], {
    stdio: 'inherit', env: { ...process.env, HISTORY_HOTFIX_MODE: mode },
  })
  assert.equal(result.status, 0, `DBREAL_HISTORY_${mode.toUpperCase()}_FAILED`)
}
async function catalog() {
  const result = {}
  result.constraints = (await db.query("SELECT conname,pg_get_constraintdef(oid) definition,convalidated FROM pg_constraint WHERE conrelid IN ('public.workday_record_history'::regclass,'public.workday_records'::regclass) AND conname<>'workday_record_history_identity_key' ORDER BY conname")).rows
  result.tables = (await db.query("SELECT relname,relrowsecurity,relforcerowsecurity,relacl FROM pg_class WHERE oid IN ('public.workday_record_history'::regclass,'public.workday_records'::regclass) ORDER BY relname")).rows
  result.columns = (await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('workday_record_history','workday_records') ORDER BY table_name,ordinal_position")).rows
  result.policies = (await db.query("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('workday_record_history','workday_records') ORDER BY tablename,policyname")).rows
  result.triggers = (await db.query("SELECT tgname,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid IN ('public.workday_record_history'::regclass,'public.workday_records'::regclass) AND NOT tgisinternal ORDER BY tgname")).rows
  result.indexes = (await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('workday_record_history','workday_records') AND indexname<>'workday_record_history_identity_key' ORDER BY tablename,indexname")).rows
  result.rpc = (await db.query("SELECT pg_get_functiondef(oid) definition,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='upsert_workday_record' ORDER BY oid")).rows
  return result
}
try {
  await db.connect()
  runTests('reproduce')
  const before = await catalog()
  for (const file of ['107_history_uniqueness_precheck.sql','108_history_uniqueness_fix.sql','109_history_uniqueness_postcheck.sql']) {
    await db.query(await readFile(new URL('../database/live-schema/' + file, import.meta.url), 'utf8'))
    console.log(file + '=PASS')
  }
  assert.deepEqual(await catalog(), before, 'all remaining constraints, indexes, columns, triggers, RPC definitions/ACL, permissions and RLS unchanged')
  console.log('CATALOG_PRESERVATION=PASS')
  runTests('verify')
} finally {
  await db.query('ROLLBACK').catch(() => {})
  await db.end()
}
