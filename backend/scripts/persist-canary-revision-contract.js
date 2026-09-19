'use strict'

const { createHash } = require('node:crypto')

const APPROVED_REVISION_CANARY = Object.freeze({
  registro_id: '5707fc4d-833a-48ab-bf49-90f5b30e0174',
  cliente_id: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  empleado_id: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  assignment_id: '2984316c-1c93-4f66-853e-349f90b9f82c',
  schedule_id: '5a753368-f019-4230-89e2-79beaa39ff0f',
  operative_date: '2026-09-09',
  timezone: 'America/Cancun',
  schedule_revision_id: '09df6a75-e231-4654-ae70-8448bdf2c312',
  revision_version: 1,
  revision_integrity_hash: '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866',
  calculation_version: 3,
})

const EXPECTED_RUNTIME = Object.freeze({
  runtime_version: 'attendance-runtime-v1',
  build_sha: '6a36e31633594c4b256b03b5d3ca02a72ed8874d8b941a37affa1723e34c6d66',
})

const REVISION_FEATURE_KEY = 'REVISION_SCHEDULE_RESOLVER'
const PERSIST_FEATURE_KEY = 'WORKDAY_PERSIST_CANARY'
const MANIFEST_CONFIRMATION = 'I_GENERATE_FRESH_READ_ONLY_REVISION_CANARY_MANIFEST'
const PERSIST_CONFIRMATION = 'I_AUTHORIZE_EXACT_REVISION_V3_PERSIST_CANARY'
const V3_RPC_SIGNATURE = 'public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,text,integer,uuid)'

class PersistCanaryRevisionError extends Error {
  constructor(message, code, cause) {
    super(message)
    this.name = 'PersistCanaryRevisionError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function fail(message, code) {
  throw new PersistCanaryRevisionError(message, code)
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('El manifest contiene un numero no finito.', 'PERSIST_CANARY_MANIFEST_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (!value || typeof value !== 'object') fail('El manifest contiene un tipo no soportado.', 'PERSIST_CANARY_MANIFEST_INVALID')
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')
}

function assertExactIdentity(identity, code = 'PERSIST_CANARY_IDENTITY_DENIED') {
  if (!identity || typeof identity !== 'object') fail('La identidad del canary es obligatoria.', code)
  for (const [field, expected] of Object.entries(APPROVED_REVISION_CANARY)) {
    if (identity[field] !== expected) fail(`${field} no coincide con el canary revisionado aprobado.`, code)
  }
  return { ...APPROVED_REVISION_CANARY }
}

function assertRuntimeIdentity(runtime) {
  if (!runtime || runtime.runtime_version !== EXPECTED_RUNTIME.runtime_version || runtime.build_sha !== EXPECTED_RUNTIME.build_sha) {
    fail('El runtime/build no coincide con la evidencia Cloud Run aprobada.', 'PERSIST_CANARY_RUNTIME_IDENTITY_DENIED')
  }
  return { ...EXPECTED_RUNTIME }
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') fail('El snapshot V3 es obligatorio.', 'PERSIST_CANARY_SNAPSHOT_INVALID')
  const required = [
    'first_in', 'last_out', 'worked_minutes', 'break_minutes', 'overtime_minutes',
    'late_minutes', 'early_leave_minutes', 'status', 'calculation_version', 'integrity_hash',
  ]
  for (const field of required) {
    if (!Object.hasOwn(snapshot, field)) fail(`Falta ${field} en snapshot V3.`, 'PERSIST_CANARY_SNAPSHOT_INVALID')
  }
  if (snapshot.calculation_version !== 3 || typeof snapshot.integrity_hash !== 'string' || snapshot.integrity_hash.length === 0) {
    fail('El snapshot no cumple calculation_version/integrity_hash V3.', 'PERSIST_CANARY_SNAPSHOT_INVALID')
  }
  for (const field of ['worked_minutes', 'break_minutes', 'overtime_minutes', 'late_minutes', 'early_leave_minutes']) {
    if (!Number.isInteger(snapshot[field]) || snapshot[field] < 0) fail(`${field} es invalido.`, 'PERSIST_CANARY_SNAPSHOT_INVALID')
  }
  if (typeof snapshot.status !== 'string' || snapshot.status.length === 0) fail('status es invalido.', 'PERSIST_CANARY_SNAPSHOT_INVALID')
  return snapshot
}

function manifestPayload(manifest) {
  return {
    manifest_version: manifest.manifest_version,
    phase: manifest.phase,
    mode: manifest.mode,
    source: manifest.source,
    identity: manifest.identity,
    snapshot: manifest.snapshot,
    counters: manifest.counters,
  }
}

function assertManifest(manifest, expectedSha) {
  if (!manifest || typeof manifest !== 'object' || manifest.phase !== '65_persist_canary_revision_shadow_manifest' ||
      manifest.mode !== 'READ_ONLY_SHADOW_MANIFEST' || manifest.manifest_version !== 1) {
    fail('El manifest no es un manifest revisionado V1 valido.', 'PERSIST_CANARY_MANIFEST_INVALID')
  }
  assertExactIdentity(manifest.identity)
  assertRuntimeIdentity(manifest.source?.runtime)
  assertSnapshot(manifest.snapshot)
  const counters = manifest.counters
  for (const field of ['databaseWrites', 'persistenceCalls', 'rpcWriteCalls', 'storageWriteCalls', 'indirectSupabaseCalls', 'incidentWriteCalls']) {
    if (counters?.[field] !== 0) fail('El manifest no fue estrictamente read-only.', 'PERSIST_CANARY_MANIFEST_NOT_READ_ONLY')
  }
  const actualSha = sha256Canonical(manifestPayload(manifest))
  if (manifest.manifest_sha256 !== actualSha || (expectedSha && expectedSha !== actualSha)) {
    fail('El SHA del manifest no coincide.', 'PERSIST_CANARY_MANIFEST_SHA_MISMATCH')
  }
  return actualSha
}

module.exports = {
  APPROVED_REVISION_CANARY,
  EXPECTED_RUNTIME,
  REVISION_FEATURE_KEY,
  PERSIST_FEATURE_KEY,
  MANIFEST_CONFIRMATION,
  PERSIST_CONFIRMATION,
  V3_RPC_SIGNATURE,
  PersistCanaryRevisionError,
  canonicalize,
  sha256Canonical,
  assertExactIdentity,
  assertRuntimeIdentity,
  assertSnapshot,
  manifestPayload,
  assertManifest,
}
