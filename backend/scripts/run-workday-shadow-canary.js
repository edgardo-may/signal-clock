'use strict'

/**
 * Manual-only Phase 31 local canary.
 *
 * It has no Supabase client, network client, RPC client, listener, or writer.
 * Its fixtures preserve the public.registro_asistencia / devices / empleados /
 * empleados_horarios / horarios field contracts used by the runtime.
 */

const { AttendanceEngineOrchestrator } = require('../services/attendance/AttendanceEngineOrchestrator.js')
const { createHash } = require('node:crypto')

const TIMEZONE = 'America/Cancun'
const TENANT = 'shadow-tenant'
const EMPLOYEE = 'shadow-employee'

function localToUtc(date, time) {
  // The domain loader remains the authority for all actual calculations. These
  // fixed offsets are only for the September 2026 fixture in America/Cancun.
  return new Date(`${date}T${time}:00-05:00`).toISOString()
}

function registro(id, date, time, tipoVerificacion) {
  return {
    id,
    cliente_id: TENANT,
    empleado_id: EMPLOYEE,
    dispositivo_id: 'shadow-device',
    verificado_at: localToUtc(date, time),
    tipo_verificacion: tipoVerificacion,
    metodo: 'face',
    source_event_id: `source-${id}`,
    raw_payload: { opaque: true },
    es_manual: false,
  }
}

function postgresJsonbText(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(', ')}]`
  const bytes = (key) => Buffer.from(key, 'utf8')
  const compare = (left, right) => bytes(left).length - bytes(right).length || Buffer.compare(bytes(left), bytes(right))
  return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(', ')}}`
}

function revision(id, diasConfig) {
  const config_snapshot = {
    calculation_contract_version: 1,
    dias_config: {
      lun: { activo: false }, mar: { activo: false }, mie: { activo: false }, jue: { activo: false },
      vie: { activo: false }, sab: { activo: false }, dom: { activo: false }, ...diasConfig,
    },
    tolerancia_minutos: 10,
    horario_activo: true,
  }
  const hashPayload = {
    calculation_contract_version: config_snapshot.calculation_contract_version,
    dias_config: config_snapshot.dias_config,
    tolerancia_minutos: config_snapshot.tolerancia_minutos,
    horario_activo: config_snapshot.horario_activo,
  }
  return {
    id: `revision-${id}`,
    cliente_id: TENANT,
    horario_id: id,
    version: 1,
    config_snapshot,
    integrity_hash: createHash('sha256')['update'](postgresJsonbText(hashPayload), 'utf8').digest('hex'),
  }
}

function assignment(horarioId) {
  return {
    id: `assignment-${horarioId}`,
    cliente_id: TENANT,
    empleado_id: EMPLOYEE,
    horario_id: horarioId,
    schedule_revision_id: `revision-${horarioId}`,
    fecha_inicio: '2026-01-01',
    fecha_fin: null,
    activo: true,
  }
}

function localCanaryFixtures() {
  return {
    normal: {
      anchorId: 'normal-out',
      records: [
        registro('normal-in', '2026-09-04', '08:00', 'entrada'),
        registro('normal-out', '2026-09-04', '17:00', 'salida'),
      ],
      assignments: [assignment('normal-schedule')],
      revisions: [revision('normal-schedule', {
        vie: { activo: true, entrada: '08:00', salida: '17:00' },
      })],
    },
    night: {
      anchorId: 'night-out',
      records: [
        registro('night-in', '2026-09-04', '22:00', 'entrada'),
        registro('night-out', '2026-09-05', '06:00', 'salida'),
      ],
      assignments: [assignment('night-schedule')],
      revisions: [revision('night-schedule', {
        vie: { activo: true, entrada: '22:00', salida: '06:00' },
      })],
    },
  }
}

class ShadowCanaryRepository {
  constructor(fixture) {
    this.fixture = fixture
    this.persistenceCallCount = 0
    this.writeCallCount = 0
  }

  async loadRegistro(id) {
    return this.fixture.records.find((record) => record.id === id) || null
  }

  async loadDevice({ deviceId }) {
    return deviceId === 'shadow-device'
      ? { id: 'shadow-device', cliente_id: TENANT, timezone: TIMEZONE }
      : null
  }

  async loadEmployee() {
    return { id: EMPLOYEE, cliente_id: TENANT }
  }

  async loadScheduleContext() {
    return { assignments: this.fixture.assignments, revisions: this.fixture.revisions }
  }

  async loadAttendanceEvents({ clienteId, empleadoId, startUtc, endUtc }) {
    return this.fixture.records.filter((record) =>
      record.cliente_id === clienteId && record.empleado_id === empleadoId &&
      new Date(record.verificado_at) >= new Date(startUtc) && new Date(record.verificado_at) <= new Date(endUtc)
    )
  }

  async loadDevices({ deviceIds }) {
    return deviceIds.includes('shadow-device')
      ? [{ id: 'shadow-device', cliente_id: TENANT, timezone: TIMEZONE }]
      : []
  }
}

function comparable(result) {
  const record = result.workdayRecord
  return {
    operativeDate: result.operativeDate,
    scheduleId: record.schedule_id,
    timezone: record.timezone,
    actualStart: record.first_in,
    actualEnd: record.last_out,
    workedMinutes: record.worked_minutes,
    breakMinutes: record.break_minutes,
    overtimeMinutes: record.overtime_minutes,
    lateMinutes: record.late_minutes,
    earlyLeaveMinutes: record.early_leave_minutes,
    workdayState: record.status,
    integrityHash: record.integrity_hash,
  }
}

function nodeRuntimeCompatible(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 6)
}

async function runCanary(name, fixture) {
  const repository = new ShadowCanaryRepository(fixture)
  const persistenceSpy = {
    persist: async () => {
      repository.persistenceCallCount++
      throw new Error('SHADOW must not invoke persistence')
    },
  }
  const orchestrator = new AttendanceEngineOrchestrator({
    repository,
    mode: 'SHADOW',
    persistenceService: persistenceSpy,
    logger: { info: () => {}, error: () => {} },
  })
  const first = await orchestrator.run({ registroId: fixture.anchorId })
  const second = await orchestrator.run({ registroId: fixture.anchorId })
  const firstComparable = comparable(first)
  const secondComparable = comparable(second)
  if (JSON.stringify(firstComparable) !== JSON.stringify(secondComparable)) {
    throw new Error(`${name}: resultado no determinista`)
  }
  if (repository.persistenceCallCount !== 0 || repository.writeCallCount !== 0) {
    throw new Error(`${name}: SHADOW intentó escribir`)
  }
  return {
    CANARY_MODE: 'SHADOW',
    canary: name,
    registroId: first.registroId,
    clienteId: first.workdayRecord.cliente_id,
    empleadoId: first.workdayRecord.empleado_id,
    deviceId: first.deviceId,
    ...firstComparable,
    persistenceCalled: false,
    persistenceCallCount: repository.persistenceCallCount,
    writeCallCount: repository.writeCallCount,
    deterministicReplay: true,
  }
}

async function runLocalShadowCanary() {
  const fixtures = localCanaryFixtures()
  const normal = await runCanary('NORMAL', fixtures.normal)
  const night = await runCanary('NIGHT', fixtures.night)
  return {
    nodeVersion: process.versions.node,
    nodeRuntimeCompatible: nodeRuntimeCompatible(),
    persistenceCallCount: normal.persistenceCallCount + night.persistenceCallCount,
    writeCallCount: normal.writeCallCount + night.writeCallCount,
    canaries: [normal, night],
  }
}

if (require.main === module) {
  if (process.argv.length !== 2) {
    console.error('Uso: node backend/scripts/run-workday-shadow-canary.js')
    process.exitCode = 2
  } else {
    runLocalShadowCanary()
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => {
        console.error(JSON.stringify({ CANARY_MODE: 'SHADOW', error: error.message, code: error.code || 'CANARY_FAILED' }))
        process.exitCode = 1
      })
  }
}

module.exports = {
  ShadowCanaryRepository,
  comparable,
  localCanaryFixtures,
  nodeRuntimeCompatible,
  runCanary,
  runLocalShadowCanary,
}
