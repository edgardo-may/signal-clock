/**
 * Phase 58 read-only shadow for the approved C assignment.
 *
 * It has no DML, no RPC and no engine/persistence entry point. It reads the
 * immutable assignment+revision and the parent schedule independently, then
 * compares their calculation semantics for Monday/Saturday/Sunday.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  ScheduleResolver,
  computeScheduleRevisionIntegrityHash,
  legacyLiveScheduleToShadowShift,
  compareRevisionResolutionToLegacyShadow,
} from '../src/domain/attendance/index.ts'

const EXPECTED = Object.freeze({
  tenantId: '69095bd5-fee5-4237-a1a4-186dd88310ff',
  employeeId: '6c94a683-1fbd-4427-af9e-8ea154ea50fa',
  assignmentId: '2984316c-1c93-4f66-853e-349f90b9f82c',
  scheduleId: '5a753368-f019-4230-89e2-79beaa39ff0f',
  revisionId: '09df6a75-e231-4654-ae70-8448bdf2c312',
  integrityHash: '77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866',
  dates: ['2026-09-14', '2026-09-12', '2026-09-13'],
})
const APPROVED_HOST = 'tuhrqoihccfumlaxnbor.supabase.co'

function readDotEnv(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

async function selectSingle(query, label) {
  const { data, error } = await query.single()
  if (error || !data) throw new Error(`${label}: ${error?.code ?? 'NOT_FOUND'} ${error?.message ?? ''}`)
  return data
}

const env = readDotEnv(new URL('../backend/.env', import.meta.url))
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('READ_ONLY_SHADOW_ENV_MISSING')
if (new URL(env.SUPABASE_URL).host !== APPROVED_HOST) throw new Error('READ_ONLY_SHADOW_HOST_DENIED')

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// These are three constant SELECTs for one pre-approved evidence target; this
// is a diagnostic, not the production resolver query. No relation is used as
// a fallback and no value from `liveSchedule` reaches ScheduleResolver.
const assignment = await selectSingle(
  supabase.from('empleados_horarios')
    .select('id,cliente_id,empleado_id,horario_id,schedule_revision_id,fecha_inicio,fecha_fin,activo')
    .eq('id', EXPECTED.assignmentId).eq('cliente_id', EXPECTED.tenantId),
  'assignment',
)
const revision = await selectSingle(
  supabase.from('schedule_revisions')
    .select('id,cliente_id,horario_id,version,config_snapshot,integrity_hash')
    .eq('id', EXPECTED.revisionId).eq('cliente_id', EXPECTED.tenantId),
  'revision',
)
const liveSchedule = await selectSingle(
  supabase.from('horarios')
    .select('id,cliente_id,nombre,activo,dias_config,tolerancia_minutos')
    .eq('id', EXPECTED.scheduleId).eq('cliente_id', EXPECTED.tenantId),
  'liveSchedule',
)

const identityMatches = assignment.id === EXPECTED.assignmentId
  && assignment.cliente_id === EXPECTED.tenantId
  && assignment.empleado_id === EXPECTED.employeeId
  && assignment.horario_id === EXPECTED.scheduleId
  && assignment.schedule_revision_id === EXPECTED.revisionId
  && revision.id === EXPECTED.revisionId
  && revision.cliente_id === assignment.cliente_id
  && revision.horario_id === assignment.horario_id
  && revision.version === 1
  && revision.integrity_hash === EXPECTED.integrityHash
const backendHash = computeScheduleRevisionIntegrityHash(revision.config_snapshot)
if (!identityMatches || backendHash !== revision.integrity_hash) throw new Error('READ_ONLY_SHADOW_IDENTITY_OR_HASH_MISMATCH')

const comparisons = EXPECTED.dates.map((candidateDate) => {
  const revisionResolution = ScheduleResolver.resolve({
    clienteId: assignment.cliente_id,
    empleadoId: assignment.empleado_id,
    candidateDate,
    assignments: [assignment],
    revisions: [revision],
  })
  const legacyShift = legacyLiveScheduleToShadowShift(liveSchedule, candidateDate)
  return { candidateDate, ...compareRevisionResolutionToLegacyShadow(revisionResolution, legacyShift) }
})

const result = {
  phase: '58_schedule_resolver_revision_shadow',
  mode: 'READ_ONLY_SHADOW',
  databaseWrites: 0,
  rpcWrites: 0,
  resolverActivated: false,
  persistCanarySelected: false,
  engineActivated: false,
  identity: {
    assignmentId: assignment.id,
    scheduleId: assignment.horario_id,
    revisionId: revision.id,
    version: revision.version,
    integrityHash: revision.integrity_hash,
  },
  backendHash,
  comparisons,
  parity: comparisons.every((comparison) => comparison.equal),
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.parity) process.exitCode = 3
