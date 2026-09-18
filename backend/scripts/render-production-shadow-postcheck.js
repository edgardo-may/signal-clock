'use strict'

/**
 * Local-only Phase 33 -> Phase 34 handoff.
 *
 * It reads a JSON snapshot captured by the read-only Phase 33 SQL and renders
 * a one-run copy of the read-only Phase 34 template. This module never loads
 * environment variables, connects to Supabase, or imports runtime services.
 */

const fs = require('fs/promises')
const path = require('path')

const APPROVED_REGISTRO_ID = '7f99cef9-4100-48ff-9aaf-68548c80c948'
const TEMPLATE_PATH = path.resolve(__dirname, '../../database/live-schema/34_production_shadow_postcheck.sql')
const BASELINE_MARKER = '/* PHASE_33_BASELINE_JSON */ NULL::jsonb'
const COUNT_KEYS = Object.freeze([
  'devices',
  'horarios',
  'incidencias',
  'workday_records',
  'empleados_horarios',
  'registro_asistencia',
  'attendance_source_events',
])

class ProductionShadowBaselineError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ProductionShadowBaselineError'
    this.code = code
  }
}

function unwrapBaseline(input) {
  if (Array.isArray(input)) {
    if (input.length !== 1) return null
    return unwrapBaseline(input[0])
  }
  if (!input || typeof input !== 'object') return null
  return input.production_shadow_baseline || input
}

function isNonNegativeInteger(value) {
  return (typeof value === 'number' || typeof value === 'string')
    && /^(0|[1-9]\d*)$/.test(String(value))
}

function validateBaseline(input) {
  const baseline = unwrapBaseline(input)
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new ProductionShadowBaselineError('El archivo no contiene un baseline Phase 33 único.', 'BASELINE_INVALID')
  }
  if (baseline.phase !== '33_production_shadow_baseline' || baseline.read_only !== 'on') {
    throw new ProductionShadowBaselineError('El baseline no acredita Phase 33 read-only.', 'BASELINE_INVALID')
  }
  if (baseline.candidate_registro_id !== APPROVED_REGISTRO_ID) {
    throw new ProductionShadowBaselineError('El baseline no pertenece al candidato aprobado.', 'BASELINE_CANDIDATE_DENIED')
  }
  if (!/^[0-9a-f]{32}$/.test(baseline.baseline_id || '')) {
    throw new ProductionShadowBaselineError('El baseline no tiene un identificador de captura válido.', 'BASELINE_INVALID')
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(baseline.captured_at_utc || '')) {
    throw new ProductionShadowBaselineError('El baseline no tiene una marca de captura UTC válida.', 'BASELINE_INVALID')
  }
  if (!/^[0-9a-f]{32}$/.test(baseline.legacy_trigger_fingerprint || '')) {
    throw new ProductionShadowBaselineError('El baseline no tiene un fingerprint legacy válido.', 'BASELINE_INVALID')
  }
  if (!baseline.counts || typeof baseline.counts !== 'object' || Array.isArray(baseline.counts)) {
    throw new ProductionShadowBaselineError('El baseline no contiene counts válidos.', 'BASELINE_INVALID')
  }
  for (const key of COUNT_KEYS) {
    if (!isNonNegativeInteger(baseline.counts[key])) {
      throw new ProductionShadowBaselineError(`El count ${key} no es un entero no negativo.`, 'BASELINE_INVALID')
    }
  }
  return baseline
}

function sqlJsonLiteral(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`
}

function renderPostcheckSql(template, baselineInput) {
  const baseline = validateBaseline(baselineInput)
  if (typeof template !== 'string' || !template.includes(BASELINE_MARKER)) {
    throw new ProductionShadowBaselineError('La plantilla Phase 34 no tiene el marcador de baseline esperado.', 'POSTCHECK_TEMPLATE_INVALID')
  }
  return template.replace(BASELINE_MARKER, sqlJsonLiteral(baseline))
}

function parseArguments(argv) {
  const baselineIndex = argv.indexOf('--baseline-file')
  const outputIndex = argv.indexOf('--output')
  if (baselineIndex === -1 || outputIndex === -1 || !argv[baselineIndex + 1] || !argv[outputIndex + 1]) {
    throw new ProductionShadowBaselineError(
      'Uso: node backend/scripts/render-production-shadow-postcheck.js --baseline-file <phase-33.json> --output <phase-34.sql>',
      'POSTCHECK_USAGE'
    )
  }
  if (argv.length !== 4) {
    throw new ProductionShadowBaselineError('Sólo se permiten --baseline-file y --output.', 'POSTCHECK_USAGE')
  }
  return { baselineFile: argv[baselineIndex + 1], output: argv[outputIndex + 1] }
}

async function main(argv = process.argv.slice(2)) {
  const { baselineFile, output } = parseArguments(argv)
  const [baselineText, template] = await Promise.all([
    fs.readFile(path.resolve(baselineFile), 'utf8'),
    fs.readFile(TEMPLATE_PATH, 'utf8'),
  ])
  let parsed
  try {
    parsed = JSON.parse(baselineText)
  } catch {
    throw new ProductionShadowBaselineError('El archivo baseline no es JSON válido.', 'BASELINE_INVALID')
  }
  const baseline = validateBaseline(parsed)
  const rendered = renderPostcheckSql(template, baseline)
  await fs.writeFile(path.resolve(output), rendered, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(`${JSON.stringify({
    rendered: true,
    baselineId: baseline.baseline_id,
    candidateRegistroId: baseline.candidate_registro_id,
    output: path.resolve(output),
    databaseWrites: 0,
  })}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'POSTCHECK_RENDER_FAILED', message: error.message })}\n`)
    process.exitCode = 2
  })
}

module.exports = {
  APPROVED_REGISTRO_ID,
  BASELINE_MARKER,
  COUNT_KEYS,
  ProductionShadowBaselineError,
  unwrapBaseline,
  validateBaseline,
  renderPostcheckSql,
  parseArguments,
}
