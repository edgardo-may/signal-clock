import { createRequire } from 'node:module'
import { cleanupWorkdayEvolutionFixture } from './workdayEvolutionDbreal.js'

const require = createRequire(import.meta.url)
const { getCalculationEngine } = require('../../backend/services/attendance/CalculationEngineRegistry.js')

// Explicit test-only registry, injected through the production orchestrator's
// engineResolver hook. Production never discovers or imports this module.
export function createTestCalculationEngineRegistry(additionalEngines) {
  const engines = new Map(additionalEngines.map(engine => [engine.calculationVersion, engine]))
  const requestedVersions = [], executedVersions = [], selectedEngines = []
  return {
    requestedVersions, executedVersions, selectedEngines,
    get(version) {
      requestedVersions.push(version)
      const engine = engines.get(version) || getCalculationEngine(version)
      selectedEngines.push(engine)
      return { calculationVersion: engine.calculationVersion, calculate(...args) {
        executedVersions.push(version)
        return engine.calculate(...args)
      } }
    },
  }
}

// JSONB transport mirrors PostgREST strings for DATE and timestamptz fields.
export function createRevisionReadRepository(db) {
  const rows = async (sql, params) => (await db.query(sql, params)).rows.map(row => row.value)
  const single = async (sql, params) => (await rows(sql, params))[0]
  return {
    loadRegistro: id => single('SELECT to_jsonb(r) value FROM public.registro_asistencia r WHERE id=$1', [id]),
    loadDevice: ({clienteId,deviceId}) => single('SELECT to_jsonb(d) value FROM public.devices d WHERE id=$1 AND cliente_id=$2', [deviceId,clienteId]),
    loadEmployee: ({clienteId,empleadoId}) => single('SELECT to_jsonb(e) value FROM public.empleados e WHERE id=$1 AND cliente_id=$2', [empleadoId,clienteId]),
    loadScheduleContext: async ({clienteId,empleadoId}) => ({
      assignments: await rows('SELECT to_jsonb(a) value FROM public.empleados_horarios a WHERE cliente_id=$1 AND empleado_id=$2 AND activo', [clienteId,empleadoId]),
      revisions: await rows('SELECT to_jsonb(r) value FROM public.schedule_revisions r WHERE cliente_id=$1', [clienteId]),
    }),
    loadCurrentWorkday: ({clienteId,empleadoId,workdayDate}) => single('SELECT to_jsonb(w) value FROM public.workday_records w WHERE cliente_id=$1 AND empleado_id=$2 AND workday_date=$3', [clienteId,empleadoId,workdayDate]),
    loadAttendanceEvents: ({clienteId,empleadoId,startUtc,endUtc}) => rows('SELECT to_jsonb(r) value FROM public.registro_asistencia r WHERE cliente_id=$1 AND empleado_id=$2 AND verificado_at BETWEEN $3 AND $4 ORDER BY verificado_at,id', [clienteId,empleadoId,startUtc,endUtc]),
    loadDevices: ({clienteId,deviceIds}) => rows('SELECT to_jsonb(d) value FROM public.devices d WHERE cliente_id=$1 AND id=ANY($2::uuid[])', [clienteId,deviceIds]),
  }
}

export async function revisionRpc(db, name, params) {
  const keys = Object.keys(params)
  await db.query('SET LOCAL ROLE service_role')
  const result = (await db.query(`SELECT * FROM public.${name}(${keys.map((key,i) => key+' => $'+(i+1)).join(',')})`, keys.map(key => params[key]))).rows
  await db.query('RESET ROLE')
  return result
}

export function revisionRpcAdapter(db) {
  return { rpc: async (name, params) => {
    try { return {data: await revisionRpc(db,name,params),error:null} }
    catch(error) { return {data:null,error:{message:error.message,code:error.code,details:error.detail}} }
  } }
}

export async function cleanupRevisionFixture(db, fixture) {
  // Committed immutable fixtures use the existing isolated audit cleanup
  // mechanism. Ordinary evidence/incident triggers remain active: their rows
  // are explicitly removed by tenant, never prevented or deleted by count.
  await db.query('BEGIN')
  try {
    await db.query('SET LOCAL session_replication_role=replica')
    const ids = [fixture.tenantA.id,fixture.tenantB.id]
    await db.query('DELETE FROM public.workday_revision_promotions WHERE cliente_id=ANY($1::uuid[])',[ids])
    await db.query('DELETE FROM public.workday_records WHERE cliente_id=ANY($1::uuid[])',[ids])
    await db.query('DELETE FROM public.workday_calculation_revisions WHERE cliente_id=ANY($1::uuid[])',[ids])
    await db.query('COMMIT')
  } catch(error) { await db.query('ROLLBACK'); throw error }
  await cleanupWorkdayEvolutionFixture(db,fixture)
}
