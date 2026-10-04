import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { auditConfig } from '../helpers/testDb.js'

const config = auditConfig()
test('schema 114 preflight verifies installed 18/20-arg RPCs without writes or secret output', { skip: !config.ready && 'Explicit DBREAL configuration required' }, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(config.dbUrl).hostname))
  assert.equal(new URL(config.dbUrl).port, '54322')
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(config.url).hostname))
  const db = new pg.Client({ connectionString: config.dbUrl })
  await db.connect()
  const counts = async () => (await db.query(`SELECT
    (SELECT count(*) FROM public.workday_records) workdays,
    (SELECT count(*) FROM public.workday_record_history) history,
    (SELECT count(*) FROM public.workday_calculation_revisions) revisions,
    (SELECT count(*) FROM public.workday_revision_promotions) audit,
    (SELECT count(*) FROM public.tenant_features) gates`)).rows[0]
  try {
    const before = await counts()
    const result = spawnSync(process.execPath, ['scripts/dbreal-preflight.mjs'], { encoding: 'utf8', timeout: 30000 })
    assert.equal(result.status, 0, 'Preflight must accept the installed Phase B contract')
    assert.match(result.stdout, /RPC 18-arg grants: service_role=true; anon=false; authenticated=false; public=false/)
    assert.match(result.stdout, /RPC 20-arg grants: service_role=true; anon=false; authenticated=false; public=false/)
    assert.match(result.stdout, /DBREAL preflight PASS/)
    for (const secret of [config.anonKey, config.serviceKey, config.dbUrl]) {
      if (secret) assert.equal((result.stdout + result.stderr).includes(secret), false, 'No credential may appear in preflight output')
    }
    assert.deepEqual(await counts(), before)
  } finally { await db.end() }
})
