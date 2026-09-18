'use strict'

// Local-only renderer for Phase 45. It has no Supabase client or database path.
const fs = require('fs/promises')
const path = require('path')

const TEMPLATE_PATH = path.resolve(__dirname, '../../database/live-schema/45_persist_canary_postcheck.sql')
const BASELINE_MARKER = '/* PERSIST_CANARY_BASELINE_JSON */ NULL::jsonb'
const RUNNER_MARKER = '/* PERSIST_CANARY_RUNNER_RESULT_JSON */ NULL::jsonb'
const COUNT_KEYS = Object.freeze([
  'workday_records', 'workday_record_history', 'tenant_features', 'incidencias',
  'registro_asistencia', 'empleados', 'horarios', 'empleados_horarios', 'devices', 'attendance_source_events',
])

class PersistCanaryPostcheckRenderError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'PersistCanaryPostcheckRenderError'
    this.code = code
  }
}

function unwrap(value, key) {
  return value?.[key] || value
}

function isNonNegativeInteger(value) {
  return (typeof value === 'number' || typeof value === 'string') && /^(0|[1-9]\d*)$/.test(String(value))
}

function validateBaseline(input) {
  const baseline = unwrap(input, 'persist_canary_global_baseline')
  if (!baseline || baseline.phase !== '36_2_persist_canary_global_baseline' || baseline.read_only !== 'on' ||
      baseline.candidate_registro_id !== '7f99cef9-4100-48ff-9aaf-68548c80c948' ||
      !/^[0-9a-f]{32}$/.test(baseline.baseline_id || '') || !baseline.counts || typeof baseline.counts !== 'object') {
    throw new PersistCanaryPostcheckRenderError('Baseline persist canary inválido.', 'PERSIST_CANARY_BASELINE_INVALID')
  }
  for (const key of COUNT_KEYS) {
    if (!isNonNegativeInteger(baseline.counts[key])) {
      throw new PersistCanaryPostcheckRenderError(`Baseline sin count válido para ${key}.`, 'PERSIST_CANARY_BASELINE_INVALID')
    }
  }
  return baseline
}

function validateRunnerResult(input) {
  if (!input || input.mode !== 'PERSIST_CANARY' || !['INSERTED', 'UNCHANGED'].includes(input.persistenceResult) ||
      input?.identity?.registroId !== '7f99cef9-4100-48ff-9aaf-68548c80c948' ||
      !/^[0-9a-f]{64}$/.test(input.integrityHash || '')) {
    throw new PersistCanaryPostcheckRenderError('Resultado del runner persist canary inválido.', 'PERSIST_CANARY_RUNNER_RESULT_INVALID')
  }
  return input
}

function jsonSqlLiteral(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`
}

function renderPostcheckSql(template, baselineInput, runnerInput) {
  const baseline = validateBaseline(baselineInput)
  const runner = validateRunnerResult(runnerInput)
  if (typeof template !== 'string' || !template.includes(BASELINE_MARKER) || !template.includes(RUNNER_MARKER)) {
    throw new PersistCanaryPostcheckRenderError('La plantilla Phase 45 no tiene ambos marcadores requeridos.', 'PERSIST_CANARY_POSTCHECK_TEMPLATE_INVALID')
  }
  return template.replace(BASELINE_MARKER, jsonSqlLiteral(baseline)).replace(RUNNER_MARKER, jsonSqlLiteral(runner))
}

function parseArguments(argv) {
  const baseline = argv.indexOf('--baseline-file')
  const runner = argv.indexOf('--runner-result-file')
  const output = argv.indexOf('--output')
  if (argv.length !== 6 || baseline === -1 || runner === -1 || output === -1 || !argv[baseline + 1] || !argv[runner + 1] || !argv[output + 1]) {
    throw new PersistCanaryPostcheckRenderError(
      'Uso: node backend/scripts/render-persist-canary-postcheck.js --baseline-file <phase-44.json> --runner-result-file <runner.json> --output <phase-45.sql>',
      'PERSIST_CANARY_POSTCHECK_USAGE'
    )
  }
  return { baselineFile: argv[baseline + 1], runnerResultFile: argv[runner + 1], output: argv[output + 1] }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv)
  const [baselineText, runnerText, template] = await Promise.all([
    fs.readFile(path.resolve(args.baselineFile), 'utf8'),
    fs.readFile(path.resolve(args.runnerResultFile), 'utf8'),
    fs.readFile(TEMPLATE_PATH, 'utf8'),
  ])
  const rendered = renderPostcheckSql(template, JSON.parse(baselineText), JSON.parse(runnerText))
  await fs.writeFile(path.resolve(args.output), rendered, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(`${JSON.stringify({ rendered: true, databaseWrites: 0, output: path.resolve(args.output) })}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'PERSIST_CANARY_POSTCHECK_RENDER_FAILED', error: error.message })}\n`)
    process.exitCode = 2
  })
}

module.exports = {
  BASELINE_MARKER,
  RUNNER_MARKER,
  COUNT_KEYS,
  PersistCanaryPostcheckRenderError,
  validateBaseline,
  validateRunnerResult,
  renderPostcheckSql,
  parseArguments,
}
