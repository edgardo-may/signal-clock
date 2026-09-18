'use strict'

const { createClient } = require('@supabase/supabase-js')
const { loadRuntimeConfig } = require('./config.js')
const { AttendanceRuntimeService } = require('./AttendanceRuntimeService.js')
const { createRuntimeApp } = require('./app.js')

function start(environment = process.env) {
  const config = loadRuntimeConfig(environment)
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const service = new AttendanceRuntimeService({ client })
  const app = createRuntimeApp({ service, config })
  const server = app.listen(config.port, () => {
    console.info('attendance_runtime_started', {
      runtime_version: config.runtimeVersion,
      build_sha: config.buildSha,
      port: config.port,
      execution_mode: 'SHADOW_ONLY',
    })
  })
  installGracefulShutdown(server, { runtimeVersion: config.runtimeVersion, buildSha: config.buildSha })
  return server
}

function installGracefulShutdown(server, { runtimeVersion, buildSha, exit = (code) => { process.exitCode = code }, logger = console } = {}) {
  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info?.('attendance_runtime_stopping', { signal, runtime_version: runtimeVersion, build_sha: buildSha })
    const forceTimer = setTimeout(() => exit(1), 10000)
    forceTimer.unref?.()
    server.close((error) => {
      clearTimeout(forceTimer)
      exit(error ? 1 : 0)
    })
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
  return shutdown
}

if (require.main === module) {
  require('dotenv').config()
  start()
}

module.exports = { start, installGracefulShutdown }
