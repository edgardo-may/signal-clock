'use strict'

const express = require('express')
const { isAuthorizedInternalRequest } = require('./config.js')
const { AttendanceRuntimeError, ENGINE_VERSION, CALCULATION_VERSION, RUNTIME_EXECUTION_MODE, RUNTIME_CAPABILITY } = require('./AttendanceRuntimeService.js')

function publicRuntimeStatus(config) {
  const activeCapable = config.runtimeCapability === RUNTIME_CAPABILITY
  return {
    status: 'ok',
    runtime_version: config.runtimeVersion,
    build_sha: config.buildSha,
    engine_version: ENGINE_VERSION,
    calculation_version: CALCULATION_VERSION,
    execution_mode: activeCapable ? RUNTIME_EXECUTION_MODE : 'SHADOW_ONLY_READ_ONLY',
    runtime_capability: config.runtimeCapability,
    resolution_modes: activeCapable ? ['SHADOW', 'ACTIVE'] : ['SHADOW'],
  }
}

function createRuntimeApp({ service, config, readinessProbe } = {}) {
  if (!service || !config) throw new Error('Attendance Runtime requiere service y config.')
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '4kb', strict: true }))

  app.get('/health', (_request, response) => response.status(200).json(publicRuntimeStatus(config)))

  app.get('/ready', async (_request, response) => {
    try {
      if (typeof readinessProbe === 'function') await readinessProbe()
      else {
        const result = await service.client.from('tenant_features').select('cliente_id').limit(1)
        if (result.error) throw result.error
      }
      response.status(200).json({ ...publicRuntimeStatus(config), database: 'reachable' })
    } catch {
      response.status(503).json({ status: 'unavailable', runtime_version: config.runtimeVersion, database: 'unreachable' })
    }
  })

  function internalResolutionRoute(execute) {
    return async (request, response) => {
      if (!isAuthorizedInternalRequest(request.get('authorization'), config.internalToken)) {
        return response.status(401).json({ error_code: 'RUNTIME_UNAUTHORIZED' })
      }
      if (!request.body || Object.keys(request.body).some((key) => key !== 'registro_id')) {
        return response.status(400).json({ error_code: 'RUNTIME_INPUT_INVALID' })
      }
      try {
        const result = await execute({ registroId: request.body.registro_id })
        return response.status(200).json(result)
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'ATTENDANCE_RUNTIME_ERROR'
        const status = error instanceof AttendanceRuntimeError && code === 'RUNTIME_INPUT_INVALID' ? 400 : 422
        return response.status(status).json({ error_code: code })
      }
    }
  }

  app.post('/internal/attendance/shadow', internalResolutionRoute((input) => service.executeShadow(input)))
  if (config.runtimeCapability === RUNTIME_CAPABILITY) {
    app.post('/internal/attendance/active', internalResolutionRoute((input) => service.executeActive(input)))
  }

  app.use((_request, response) => response.status(404).json({ error_code: 'RUNTIME_ROUTE_NOT_FOUND' }))
  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error_code: 'RUNTIME_INPUT_INVALID' })
    return response.status(500).json({ error_code: 'ATTENDANCE_RUNTIME_ERROR' })
  })
  return app
}

module.exports = { createRuntimeApp, publicRuntimeStatus }
