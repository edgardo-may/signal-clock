'use strict'

const { timingSafeEqual } = require('node:crypto')

class AttendanceRuntimeConfigError extends Error {
  constructor(message, code = 'ATTENDANCE_RUNTIME_CONFIG_INVALID') {
    super(message)
    this.name = 'AttendanceRuntimeConfigError'
    this.code = code
  }
}

function requireString(environment, name, { minimumLength = 1 } = {}) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length < minimumLength) {
    throw new AttendanceRuntimeConfigError(`Falta configuracion valida para ${name}.`, 'ATTENDANCE_RUNTIME_CONFIG_MISSING')
  }
  return value.trim()
}

function parsePort(value) {
  const port = Number(value || 8088)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AttendanceRuntimeConfigError('ATTENDANCE_RUNTIME_PORT es invalido.', 'ATTENDANCE_RUNTIME_PORT_INVALID')
  }
  return port
}

function parseRuntimeCapability(value) {
  const capability = value || 'SHADOW_ONLY'
  if (!['SHADOW_ONLY', 'ACTIVE_CAPABLE'].includes(capability)) {
    throw new AttendanceRuntimeConfigError('ATTENDANCE_RUNTIME_CAPABILITY es invalida.', 'ATTENDANCE_RUNTIME_CAPABILITY_INVALID')
  }
  return capability
}

function loadRuntimeConfig(environment = process.env) {
  const supabaseUrl = requireString(environment, 'SUPABASE_URL')
  try {
    const parsed = new URL(supabaseUrl)
    if (parsed.protocol !== 'https:') throw new Error('protocol')
  } catch {
    throw new AttendanceRuntimeConfigError('SUPABASE_URL debe usar https.', 'ATTENDANCE_RUNTIME_SUPABASE_URL_INVALID')
  }
  return Object.freeze({
    port: parsePort(environment.ATTENDANCE_RUNTIME_PORT),
    supabaseUrl,
    secretKey: requireString(environment, 'SUPABASE_SECRET_KEY', { minimumLength: 20 }),
    internalToken: requireString(environment, 'ATTENDANCE_RUNTIME_INTERNAL_TOKEN', { minimumLength: 32 }),
    runtimeVersion: requireString(environment, 'RUNTIME_VERSION'),
    buildSha: requireString(environment, 'BUILD_SHA', { minimumLength: 7 }),
    runtimeCapability: parseRuntimeCapability(environment.ATTENDANCE_RUNTIME_CAPABILITY),
  })
}

function isAuthorizedInternalRequest(value, expectedToken) {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false
  const received = Buffer.from(value.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

module.exports = {
  AttendanceRuntimeConfigError,
  loadRuntimeConfig,
  parseRuntimeCapability,
  isAuthorizedInternalRequest,
}
