import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('74.1 Cloud Run live-evidence script is read-only, exact, and keeps IAM/app bearer separate', async () => {
  const script = await readFile(new URL('../../backend/attendance-runtime/cloud-shell-runtime-live-evidence.sh', import.meta.url), 'utf8')
  assert.match(script, /signum-attendance-runtime-00002-fn5/)
  assert.match(script, /sha256:a04ed58d32c49a0b32314fcd88894088e20b1e8428469b68840c18d63f2f9b0e/)
  assert.match(script, /signum-attendance-runtime@project-88e975e6-b4b6-4423-a93\.iam\.gserviceaccount\.com/)
  assert.match(script, /internal-and-cloud-load-balancing/)
  assert.match(script, /SUPABASE_SECRET_KEY/)
  assert.match(script, /secretKeyRef/)
  assert.match(script, /SUPABASE_\.\*SERVICE_ROLE/)
  assert.match(script, /X-Serverless-Authorization/)
  assert.match(script, /Authorization: Bearer \$internal_token/)
  assert.match(script, /unauthorized_status.*401/s)
  assert.match(script, /invalid_status.*400/s)
  assert.match(script, /databaseWrites==0.*incidentWriteCalls==0/s)
  assert.doesNotMatch(script, /add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy|gcloud run deploy|gcloud run services update/i)
})

test('74.2 database postcheck remains read-only and detects runtime non-regression', async () => {
  const sql = await readFile(new URL('../../database/live-schema/74_runtime_live_evidence_postcheck.sql', import.meta.url), 'utf8')
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/)
  assert.match(sql, /runtime_live_non_regression_pass/)
  assert.match(sql, /668e4ccfa75a027b5fcc47d4963a06d1/)
  assert.match(sql, /0f87f945e84a9747e5bc275660bc7c0a/)
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\b|\.rpc\(/i)
})
