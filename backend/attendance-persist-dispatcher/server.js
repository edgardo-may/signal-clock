'use strict'
const { createClient } = require('@supabase/supabase-js')
const { loadDispatcherConfig } = require('./config.js')
const { AttendancePersistDispatcher } = require('./dispatcher.js')
async function main(environment = process.env) { const config = loadDispatcherConfig(environment); const client = createClient(config.supabaseUrl, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } }); const outcomes = await new AttendancePersistDispatcher({ client, config }).runOnce(); process.stdout.write(`${JSON.stringify({ processed: outcomes.length, outcomes })}\n`) }
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.code || 'PERSIST_DISPATCHER_ERROR'}\n`); process.exitCode = 1 })
module.exports = { main }
