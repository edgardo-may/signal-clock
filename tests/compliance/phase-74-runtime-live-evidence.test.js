import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('74.2 database postcheck remains read-only and detects runtime non-regression', async () => {
  const sql = await readFile(new URL('../../database/live-schema/74_runtime_live_evidence_postcheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
  assert.match(sql, /runtime_live_non_regression_pass/)
  assert.match(sql, /668e4ccfa75a027b5fcc47d4963a06d1/)
  assert.match(sql, /0f87f945e84a9747e5bc275660bc7c0a/)
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\b|\.rpc\(/i)
})
