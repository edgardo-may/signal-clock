/** Compare functional PostgreSQL catalogs: known-good source versus fresh baseline DB. */
import pg from 'pg'

const { Client } = pg
const source = process.env.PHASE2_AUDIT_DATABASE_URL
const target = process.env.PHASE2_BASELINE_DATABASE_URL
const label = process.env.PHASE2_AUDIT_DB_LABEL
const allow = process.env.ALLOW_DESTRUCTIVE_TEST_DB === 'true'
const productionHost = (process.env.PHASE2_PRODUCTION_HOST || '').toLowerCase()

function safe(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return !/(^|[.-])(prod|production)([.-]|$)/i.test(host) && (!productionHost || host !== productionHost)
  } catch { return false }
}
if (!source || !target || !allow || !/^(local|test|staging)$/i.test(label || '') || !safe(source) || !safe(target)) {
  throw new Error('Refusing catalog comparison: require guarded source and fresh-baseline URLs, local|test|staging label, and ALLOW_DESTRUCTIVE_TEST_DB=true.')
}

const catalogQueries = {
  tables: `SELECT c.relname AS name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`,
  columns: `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2`,
  constraints: `SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2`,
  indexes: `SELECT tablename AS table_name, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`,
  functions: `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, p.prosecdef AS security_definer, COALESCE(array_to_string(p.proconfig, ','),'') AS config, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2`,
  triggers: `SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2`,
  policies: `SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`
}

async function readCatalog(url) {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const result = {}
    for (const [name, sql] of Object.entries(catalogQueries)) result[name] = (await client.query(sql)).rows
    return result
  } finally { await client.end() }
}

function differences(left, right, path = '') {
  if (JSON.stringify(left) === JSON.stringify(right)) return []
  if (Array.isArray(left) && Array.isArray(right)) {
    const max = Math.max(left.length, right.length)
    return Array.from({ length: max }, (_, i) => differences(left[i], right[i], `${path}[${i}]`)).flat()
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences(left[key], right[key], path ? `${path}.${key}` : key))
  }
  return [{ path, source: left, baseline: right }]
}

const [knownGood, baseline] = await Promise.all([readCatalog(source), readCatalog(target)])
const diff = differences(knownGood, baseline)
if (diff.length === 0) {
  console.log('MATCH: tables, columns, PK/FK/unique/check constraints, indexes, functions/security/search_path, triggers, RLS, and policies.')
} else {
  console.log(`DIFF: ${diff.length} functional catalog difference(s).`)
  for (const item of diff.slice(0, 100)) console.log(`${item.path}\n  source: ${JSON.stringify(item.source)}\n  baseline: ${JSON.stringify(item.baseline)}`)
  process.exitCode = 1
}
