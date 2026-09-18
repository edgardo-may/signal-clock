'use strict'

/**
 * Local-only normalizer for the JSON array returned by Phase 43 in Supabase.
 * It deliberately uses JSON.parse without BOM stripping and has no database,
 * Supabase, RPC, persistence, or writer dependency.
 */

const fs = require('fs/promises')
const path = require('path')
const { assertApprovedContractEvidence, PersistCanaryManifestContractError } = require('./persist-canary-manifest-contract.js')

class PersistCanaryManifestRenderError extends Error {
  constructor(message, code, cause) {
    super(message)
    this.name = 'PersistCanaryManifestRenderError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function unwrapSupabasePhase43(value) {
  if (Array.isArray(value)) {
    if (value.length !== 1 || !value[0] || typeof value[0] !== 'object' || Array.isArray(value[0])) {
      throw new PersistCanaryManifestRenderError('Phase 43 debe contener exactamente una fila objeto.', 'PERSIST_CANARY_MANIFEST_SHAPE_DENIED')
    }
    return unwrapSupabasePhase43(value[0])
  }
  if (!value || typeof value !== 'object') {
    throw new PersistCanaryManifestRenderError('Phase 43 no contiene un objeto de evidencia.', 'PERSIST_CANARY_MANIFEST_SHAPE_DENIED')
  }
  return value.persist_canary_runner_precheck || value
}

function normalizePhase43Payload(value, approvedFingerprint) {
  const evidence = unwrapSupabasePhase43(value)
  try {
    return assertApprovedContractEvidence(evidence, approvedFingerprint)
  } catch (error) {
    if (error instanceof PersistCanaryManifestContractError) {
      throw new PersistCanaryManifestRenderError(error.message, error.code, error)
    }
    throw error
  }
}

function renderCanonicalManifest(evidence) {
  // JSON.stringify emits UTF-8 text when paired with fs.writeFile(..., 'utf8')
  // and never prepends a BOM. The trailing LF is intentional and parse-safe.
  return `${JSON.stringify(evidence, null, 2)}\n`
}

function parseArguments(argv) {
  const inputIndex = argv.indexOf('--input')
  const outputIndex = argv.indexOf('--output')
  const fingerprintIndex = argv.indexOf('--approved-rpc-fingerprint')
  if (argv.length !== 6 || inputIndex === -1 || outputIndex === -1 || fingerprintIndex === -1 ||
      !argv[inputIndex + 1] || !argv[outputIndex + 1] || !argv[fingerprintIndex + 1]) {
    throw new PersistCanaryManifestRenderError(
      'Uso: node backend/scripts/render-persist-canary-precheck-manifest.js --input <phase-43.json> --output <manifest.json> --approved-rpc-fingerprint <md5>',
      'PERSIST_CANARY_MANIFEST_USAGE'
    )
  }
  return {
    input: argv[inputIndex + 1], output: argv[outputIndex + 1], approvedRpcFingerprint: argv[fingerprintIndex + 1].toLowerCase(),
  }
}

async function renderManifest(inputPath, outputPath, approvedFingerprint, dependencies = { readFile: fs.readFile, writeFile: fs.writeFile }) {
  let parsed
  try {
    parsed = JSON.parse(await dependencies.readFile(path.resolve(inputPath), 'utf8'))
  } catch (error) {
    throw new PersistCanaryManifestRenderError('El input Phase 43 no es JSON UTF-8 válido sin BOM.', 'PERSIST_CANARY_MANIFEST_JSON_INVALID', error)
  }
  const evidence = normalizePhase43Payload(parsed, approvedFingerprint)
  const output = renderCanonicalManifest(evidence)
  await dependencies.writeFile(path.resolve(outputPath), output, { encoding: 'utf8', flag: 'wx' })
  return {
    rendered: true,
    output: path.resolve(outputPath),
    phase: evidence.phase,
    rpcFingerprint: evidence.rpc_fingerprint,
    databaseWrites: 0,
    rpcCalls: 0,
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv)
  const report = await renderManifest(args.input, args.output, args.approvedRpcFingerprint)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'PERSIST_CANARY_MANIFEST_RENDER_FAILED', error: error.message })}\n`)
    process.exitCode = 2
  })
}

module.exports = {
  PersistCanaryManifestRenderError,
  unwrapSupabasePhase43,
  normalizePhase43Payload,
  renderCanonicalManifest,
  parseArguments,
  renderManifest,
}
