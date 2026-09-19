import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const phase = (name) => readFile(new URL(`database/live-schema/${name}`, root), 'utf8')

test('85-90 keep the V3 canary authorization tenant-scoped and isolate business data DML', async () => {
  const [p85, p86, p87, p88, p89, p90] = await Promise.all(['85_persistence_final_readiness.sql','86_persistence_authorization_change.sql','87_persistence_canary_postcheck.sql','88_persistence_replay_postcheck.sql','89_persistence_production_final_postcheck.sql','90_persistence_authorization_closure.sql'].map(phase))
  for (const sql of [p85, p87, p88, p89]) { assert.match(sql, /BEGIN TRANSACTION READ ONLY/); assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\s+public\.(?:workday_records|workday_record_history)\b/i) }
  for (const sql of [p86, p90]) { assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/); assert.match(sql, /LOCK TABLE public\.tenant_features/); assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\s+public\.(?:workday_records|workday_record_history)\b/i) }
  assert.match(p86, /INSERT INTO public\.tenant_features/); assert.match(p86, /PERSIST_AUTH_AFFECTED_ROWS_INVALID/); assert.match(p90, /DELETE FROM public\.tenant_features/); assert.match(p90, /PERSIST_CLOSURE_AFFECTED_ROWS_INVALID/)
  for (const sql of [p85, p86, p87, p88, p89, p90]) { assert.match(sql, /69095bd5-fee5-4237-a1a4-186dd88310ff/); assert.match(sql, /5707fc4d-833a-48ab-bf49-90f5b30e0174/) }
})

test('postchecks require production-shaped UNCHANGED and preserve fingerprints', async () => {
  const [p87, p88, p89] = await Promise.all(['87_persistence_canary_postcheck.sql','88_persistence_replay_postcheck.sql','89_persistence_production_final_postcheck.sql'].map(phase))
  for (const sql of [p87, p88]) assert.match(sql, /persistence_result'='UNCHANGED'/)
  for (const sql of [p87, p88, p89]) { assert.match(sql, /5fe7ef34-7699-474b-b312-d0c5031a1fbe/); assert.match(sql, /668e4ccfa75a027b5fcc47d4963a06d1/); assert.match(sql, /0f87f945e84a9747e5bc275660bc7c0a/) }
})

test('v3 runtime has a dedicated write boundary and no mutable schedule fallback', async () => {
  const [service, persistence, docker] = await Promise.all(['backend/attendance-runtime-v3/AttendanceRuntimeService.js','backend/attendance-runtime-v3/tenantPersistence.js','backend/attendance-runtime-v3/Dockerfile'].map((file) => readFile(new URL(file, root), 'utf8')))
  assert.match(service, /ACTIVE_PERSIST_CAPABLE/); assert.match(service, /persistenceMode: requestedPersistenceMode/); assert.match(service, /assertPersistRecordAuthorized/); assert.doesNotMatch(service, /from\('horarios'\)/); assert.match(persistence, /WORKDAY_PERSIST_CANARY/); assert.match(docker, /WorkdayPersistenceService/)
})
