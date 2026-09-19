"use strict";

/**
 * Deliberately narrow future writer for the one revision-based V3 canary.
 * It is not part of Attendance Runtime and has no scheduler or retry loop.
 * The sole permitted mutation is one V3 RPC after all guards pass.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const {
  WorkdayPersistenceService,
} = require("../services/attendance/WorkdayPersistenceService.js");
const {
  APPROVED_REVISION_CANARY,
  EXPECTED_RUNTIME,
  REVISION_FEATURE_KEY,
  PERSIST_FEATURE_KEY,
  PERSIST_CONFIRMATION,
  PersistCanaryRevisionError,
  assertManifest,
} = require("./persist-canary-revision-contract.js");

function requireEnv(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PersistCanaryRevisionError(
      `Falta ${name}.`,
      "PERSIST_CANARY_ENV_MISSING",
    );
  }
  return value.trim();
}

function exact(value, expected, field) {
  if (value !== expected) {
    throw new PersistCanaryRevisionError(
      `${field} no coincide con el canary aprobado.`,
      "PERSIST_CANARY_IDENTITY_DENIED",
    );
  }
}

function readRunnerConfig(environment = process.env) {
  const url = requireEnv(environment, "SUPABASE_URL");
  const allowedHost = requireEnv(
    environment,
    "PERSIST_CANARY_ALLOWED_HOST",
  ).toLowerCase();

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new PersistCanaryRevisionError(
      "SUPABASE_URL es invalida.",
      "PERSIST_CANARY_DESTINATION_DENIED",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== allowedHost
  ) {
    throw new PersistCanaryRevisionError(
      "El host Supabase no esta aprobado.",
      "PERSIST_CANARY_DESTINATION_DENIED",
    );
  }

  if (
    requireEnv(environment, "PERSIST_CANARY_CONFIRMATION") !==
    PERSIST_CONFIRMATION
  ) {
    throw new PersistCanaryRevisionError(
      "La confirmacion humana de persistencia no coincide.",
      "PERSIST_CANARY_CONFIRMATION_DENIED",
    );
  }

  for (const [field, expected] of Object.entries(APPROVED_REVISION_CANARY)) {
    exact(
      requireEnv(environment, `PERSIST_CANARY_${field.toUpperCase()}`),
      String(expected),
      `PERSIST_CANARY_${field.toUpperCase()}`,
    );
  }

  const expectedResult = requireEnv(
    environment,
    "PERSIST_CANARY_EXPECTED_RESULT",
  );

  if (!["INSERTED", "UNCHANGED"].includes(expectedResult)) {
    throw new PersistCanaryRevisionError(
      "El resultado esperado debe ser INSERTED o UNCHANGED.",
      "PERSIST_CANARY_EXPECTED_RESULT_DENIED",
    );
  }

  const manifestSha = requireEnv(
    environment,
    "PERSIST_CANARY_MANIFEST_SHA256",
  ).toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(manifestSha)) {
    throw new PersistCanaryRevisionError(
      "El SHA de manifest debe ser SHA-256.",
      "PERSIST_CANARY_MANIFEST_SHA_MISMATCH",
    );
  }

  const rpcFingerprint = requireEnv(
    environment,
    "PERSIST_CANARY_APPROVED_RPC_FINGERPRINT",
  ).toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(rpcFingerprint)) {
    throw new PersistCanaryRevisionError(
      "El fingerprint RPC debe ser MD5.",
      "PERSIST_CANARY_RPC_FINGERPRINT_MISMATCH",
    );
  }

  return {
    url,
    secretKey: requireEnv(environment, "SUPABASE_SECRET_KEY"),
    manifestSha,
    rpcFingerprint,
    expectedResult,
    manifestPath: requireEnv(environment, "PERSIST_CANARY_MANIFEST_PATH"),
    precheckPath: requireEnv(
      environment,
      "PERSIST_CANARY_RUNNER_PRECHECK_PATH",
    ),
  };
}

function unwrap(value, key) {
  if (Array.isArray(value)) {
    if (value.length !== 1 || !value[0] || typeof value[0] !== "object") {
      throw new PersistCanaryRevisionError(
        "La evidencia SQL debe contener exactamente una fila.",
        "PERSIST_CANARY_PRECHECK_DENIED",
      );
    }

    return unwrap(value[0], key);
  }

  return value && typeof value === "object" && value[key] ? value[key] : value;
}

function assertRunnerPrecheck(value, config) {
  const precheck = unwrap(value, "persist_canary_runner_precheck");

  if (
    !precheck ||
    precheck.phase !== "68_persist_canary_runner_precheck" ||
    precheck.read_only !== "on" ||
    precheck.runner_precheck_pass !== true
  ) {
    throw new PersistCanaryRevisionError(
      "La evidencia Phase 68 no es valida.",
      "PERSIST_CANARY_PRECHECK_DENIED",
    );
  }

  for (const [field, expected] of Object.entries(APPROVED_REVISION_CANARY)) {
    exact(precheck.identity?.[field], expected, `precheck.identity.${field}`);
  }

  if (
    precheck.rpc_fingerprint?.toLowerCase() !== config.rpcFingerprint ||
    precheck.revision_feature_mode !== "SHADOW" ||
    precheck.active_tenants?.length !== 0
  ) {
    throw new PersistCanaryRevisionError(
      "Fingerprint/feature de Phase 68 no coincide.",
      "PERSIST_CANARY_PRECHECK_DENIED",
    );
  }

  const expectedRows = config.expectedResult === "INSERTED" ? 0 : 1;

  if (
    precheck.target_workday_rows !== expectedRows ||
    precheck.target_history_rows !== expectedRows
  ) {
    throw new PersistCanaryRevisionError(
      "El estado pre-RPC no corresponde al resultado esperado.",
      "PERSIST_CANARY_PRECHECK_DENIED",
    );
  }

  return precheck;
}

async function readJsonStrict(filePath, dependencies = {}) {
  const readFile = dependencies.readFile || fs.readFile;

  let text;

  try {
    text = await readFile(path.resolve(filePath), "utf8");
  } catch (error) {
    throw new PersistCanaryRevisionError(
      "No se pudo leer evidencia local.",
      "PERSIST_CANARY_EVIDENCE_READ_FAILED",
      error,
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PersistCanaryRevisionError(
      "La evidencia debe ser JSON UTF-8 valido sin BOM.",
      "PERSIST_CANARY_EVIDENCE_JSON_INVALID",
      error,
    );
  }
}

async function rows(client, table, columns, predicates) {
  let query = client.from(table).select(columns);

  for (const [method, name, value] of predicates) {
    query = query[method](name, value);
  }

  const response = await query;

  if (response.error) {
    throw new PersistCanaryRevisionError(
      `No se pudo leer ${table}.`,
      "PERSIST_CANARY_PRE_RPC_READ_FAILED",
      response.error,
    );
  }

  return response.data || [];
}

function assertPersistAuthorization(row) {
  const e = APPROVED_REVISION_CANARY;

  if (
    !row ||
    row.cliente_id !== e.cliente_id ||
    row.feature_key !== PERSIST_FEATURE_KEY ||
    row.mode !== "PERSIST_CANARY" ||
    row.enabled !== true ||
    row.canary_registro_id !== e.registro_id ||
    row.canary_empleado_id !== e.empleado_id ||
    row.canary_schedule_id !== e.schedule_id ||
    row.canary_workday_date !== e.operative_date
  ) {
    throw new PersistCanaryRevisionError(
      "WORKDAY_PERSIST_CANARY no autoriza exactamente esta identidad.",
      "PERSIST_CANARY_AUTHORIZATION_DENIED",
    );
  }
}

function exactTimestamp(actual, expected) {
  if (actual == null || expected == null) {
    return actual == null && expected == null;
  }

  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }

  const actualMs = Date.parse(actual);
  const expectedMs = Date.parse(expected);

  return (
    Number.isFinite(actualMs) &&
    Number.isFinite(expectedMs) &&
    actualMs === expectedMs
  );
}

function exactSnapshot(row, manifest) {
  const s = manifest.snapshot;
  const e = APPROVED_REVISION_CANARY;

  return (
    row.cliente_id === e.cliente_id &&
    row.empleado_id === e.empleado_id &&
    row.workday_date === e.operative_date &&
    row.schedule_id === e.schedule_id &&
    row.timezone === e.timezone &&
    row.calculation_version === 3 &&
    exactTimestamp(row.first_in, s.first_in) &&
    exactTimestamp(row.last_out, s.last_out) &&
    row.worked_minutes === s.worked_minutes &&
    row.break_minutes === s.break_minutes &&
    row.overtime_minutes === s.overtime_minutes &&
    row.late_minutes === s.late_minutes &&
    row.early_leave_minutes === s.early_leave_minutes &&
    row.status === s.status &&
    row.integrity_hash === s.integrity_hash
  );
}

async function revalidateImmediatelyBeforeRpc(
  client,
  manifest,
  expectedResult,
) {
  const e = APPROVED_REVISION_CANARY;

  const [persistRows, revisionRows, activeRows, workdayRows, historyRows] =
    await Promise.all([
      rows(
        client,
        "tenant_features",
        "cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date",
        [
          ["eq", "cliente_id", e.cliente_id],
          ["eq", "feature_key", PERSIST_FEATURE_KEY],
        ],
      ),

      rows(client, "tenant_features", "cliente_id,feature_key,mode,enabled", [
        ["eq", "cliente_id", e.cliente_id],
        ["eq", "feature_key", REVISION_FEATURE_KEY],
      ]),

      rows(client, "tenant_features", "cliente_id", [
        ["eq", "feature_key", REVISION_FEATURE_KEY],
        ["eq", "mode", "ACTIVE"],
        ["eq", "enabled", true],
      ]),

      rows(
        client,
        "workday_records",
        "id,cliente_id,empleado_id,workday_date,schedule_id,timezone,first_in,last_out,worked_minutes,break_minutes,overtime_minutes,late_minutes,early_leave_minutes,status,integrity_hash,calculation_version",
        [
          ["eq", "cliente_id", e.cliente_id],
          ["eq", "empleado_id", e.empleado_id],
          ["eq", "workday_date", e.operative_date],
        ],
      ),

      rows(client, "workday_record_history", "id", [
        ["eq", "cliente_id", e.cliente_id],
        ["eq", "empleado_id", e.empleado_id],
        ["eq", "workday_date", e.operative_date],
      ]),
    ]);

  if (persistRows.length !== 1) {
    throw new PersistCanaryRevisionError(
      "La autorizacion canary no es unica.",
      "PERSIST_CANARY_AUTHORIZATION_DENIED",
    );
  }

  assertPersistAuthorization(persistRows[0]);

  if (
    revisionRows.length !== 1 ||
    revisionRows[0].mode !== "SHADOW" ||
    revisionRows[0].enabled !== true ||
    activeRows.length !== 0
  ) {
    throw new PersistCanaryRevisionError(
      "REVISION_SCHEDULE_RESOLVER ya no esta seguro para persistir.",
      "PERSIST_CANARY_REVISION_FEATURE_DENIED",
    );
  }

  if (workdayRows.length > 1 || historyRows.length > 1) {
    throw new PersistCanaryRevisionError(
      "Existe conflicto de identidad logica.",
      "PERSIST_CANARY_LOGICAL_CONFLICT",
    );
  }

  if (expectedResult === "INSERTED") {
    if (workdayRows.length !== 0 || historyRows.length !== 0) {
      throw new PersistCanaryRevisionError(
        "INSERTED requiere identidad nueva.",
        "PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT",
      );
    }
  } else if (
    workdayRows.length !== 1 ||
    historyRows.length !== 1 ||
    !exactSnapshot(workdayRows[0], manifest)
  ) {
    throw new PersistCanaryRevisionError(
      "UNCHANGED requiere el snapshot existente exacto.",
      "PERSIST_CANARY_EXISTING_SNAPSHOT_CONFLICT",
    );
  }
}

function toRecord(manifest) {
  const e = APPROVED_REVISION_CANARY;

  return {
    registro_id: e.registro_id,
    cliente_id: e.cliente_id,
    empleado_id: e.empleado_id,
    workday_date: e.operative_date,
    schedule_id: e.schedule_id,
    timezone: e.timezone,
    ...manifest.snapshot,
  };
}

async function runPersistCanaryRevisionV3({
  environment = process.env,
  dependencies = {},
} = {}) {
  const config = readRunnerConfig(environment);

  const manifest = await readJsonStrict(config.manifestPath, dependencies);

  assertManifest(manifest, config.manifestSha);

  const precheck = await readJsonStrict(config.precheckPath, dependencies);

  assertRunnerPrecheck(precheck, config);

  const client = dependencies.createClient
    ? dependencies.createClient(config.url, config.secretKey)
    : createClient(config.url, config.secretKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

  await revalidateImmediatelyBeforeRpc(client, manifest, config.expectedResult);

  const persistence = await new WorkdayPersistenceService(client).persist(
    toRecord(manifest),
  );

  if (
    persistence.persistenceResult !== config.expectedResult ||
    persistence.persistenceResult === "UPDATED" ||
    persistence.integrityHash !== manifest.snapshot.integrity_hash
  ) {
    throw new PersistCanaryRevisionError(
      "La RPC no devolvio el resultado exacto autorizado.",
      "PERSIST_CANARY_RPC_RESULT_DENIED",
    );
  }

  return {
    phase: "persist_canary_revision_v3",
    identity: {
      ...APPROVED_REVISION_CANARY,
    },
    manifest_sha256: config.manifestSha,
    rpc_fingerprint: config.rpcFingerprint,
    expected_result: config.expectedResult,
    persistence_result: persistence.persistenceResult,
    workday_id: persistence.workdayId,
    integrity_hash: persistence.integrityHash,
    databaseWrites: 0,
    persistenceCalls: 1,
    rpcWriteCalls: 1,
    storageWriteCalls: 0,
    indirectSupabaseCalls: 0,
    incidentWriteCalls: 0,
  };
}

function parseArguments(argv) {
  if (argv.length !== 1 || argv[0] !== "--persist-exact-revision-canary") {
    throw new PersistCanaryRevisionError(
      "Uso: node backend/scripts/run-persist-canary-revision-v3.js --persist-exact-revision-canary",
      "PERSIST_CANARY_USAGE_DENIED",
    );
  }
}

if (require.main === module) {
  try {
    parseArguments(process.argv.slice(2));

    runPersistCanaryRevisionV3()
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(
          `${JSON.stringify({
            error_code: error.code || "PERSIST_CANARY_FAILED",
            error: error.message,
          })}\n`,
        );

        process.exitCode = 2;
      });
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        error_code: error.code || "PERSIST_CANARY_FAILED",
        error: error.message,
      })}\n`,
    );

    process.exitCode = 2;
  }
}

module.exports = {
  readRunnerConfig,
  assertRunnerPrecheck,
  readJsonStrict,
  assertPersistAuthorization,
  exactTimestamp,
  exactSnapshot,
  revalidateImmediatelyBeforeRpc,
  toRecord,
  runPersistCanaryRevisionV3,
  parseArguments,
};
