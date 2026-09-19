'use strict'
const { createClient } = require('@supabase/supabase-js'); const { loadRuntimeConfig } = require('./config.js'); const { AttendanceRuntimeService } = require('./AttendanceRuntimeService.js'); const { createRuntimeApp } = require('./app.js')
function start(environment = process.env) { const config = loadRuntimeConfig(environment); if (config.runtimeCapability !== 'ACTIVE_PERSIST_CAPABLE') throw new Error('RUNTIME_PERSIST_CAPABILITY_REQUIRED'); const client = createClient(config.supabaseUrl, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } }); const service = new AttendanceRuntimeService({ client }); return createRuntimeApp({ service, config }).listen(config.port) }
if (require.main === module) start()
module.exports = { start }
