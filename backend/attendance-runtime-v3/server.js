'use strict'
const { createClient } = require('@supabase/supabase-js'); const { loadRuntimeConfig } = require('./config.js'); const { AttendanceRuntimeService } = require('./AttendanceRuntimeService.js'); const { createRuntimeApp } = require('./app.js')
function start(environment = process.env) { const config = loadRuntimeConfig(environment); const client = createClient(config.supabaseUrl, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } }); const service = new AttendanceRuntimeService({ client, runtimeCapability: config.runtimeCapability }); return createRuntimeApp({ service, config }).listen(config.port) }
if (require.main === module) start()
module.exports = { start }
