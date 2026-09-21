import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { auditConfig, postgresAdminClient } from "./testDb.js";

const PHASES = Object.freeze({
  precheck: new URL(
    "../../database/live-schema/96_workday_evolution_precheck.sql",
    import.meta.url,
  ),
  change: new URL(
    "../../database/live-schema/97_workday_evolution_contract_change.sql",
    import.meta.url,
  ),
  postcheck: new URL(
    "../../database/live-schema/98_workday_evolution_postcheck.sql",
    import.meta.url,
  ),
});

const RPC_18 =
  "public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid,timestamptz,integer)";
const RPC_16 =
  "public.upsert_workday_record(uuid,uuid,date,uuid,text,timestamptz,timestamptz,integer,integer,integer,integer,integer,text,text,integer,uuid)";

function safeReason(config) {
  if (config.ready) return null;
  if (config.missing.length)
    return `DBREAL skipped: missing ${config.missing.join(", ")}`;
  return "DBREAL skipped: target label or host is not an approved isolated local/test/staging database";
}

function hostname(value) {
  try {
    return value ? new URL(value).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isExplicitlyRejectedTestHost(config) {
  return [hostname(config.url), hostname(config.dbUrl)].some((host) =>
    /(^|[.-])(prod|production|main)([.-]|$)/i.test(host),
  );
}

function isLoopbackHost(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname(value));
}

export function workdayEvolutionDbrealConfig() {
  const config = auditConfig();
  // auditConfig intentionally accepts only the test-prefixed variables. This
  // harness must never fall back to SUPABASE_URL or a frontend credential.
  const hostRejected =
    isExplicitlyRejectedTestHost(config) ||
    !isLoopbackHost(config.url) ||
    !isLoopbackHost(config.dbUrl);
  const ready = config.ready && !hostRejected;
  return {
    ...config,
    ready,
    skipReason: ready
      ? null
      : safeReason({
          ...config,
          missing: config.missing.length
            ? config.missing
            : ["approved isolated localhost host"],
        }),
  };
}

function phaseDocument(row) {
  return Object.values(row || {}).find(
    (value) =>
      value && typeof value === "object" && Object.hasOwn(value, "pass"),
  );
}

export async function runPhase(client, phase) {
  const sql = await readFile(PHASES[phase], "utf8");
  return client.query(sql);
}

export async function runPhaseAndRequirePass(client, phase) {
  const result = await runPhase(client, phase);
  const resultSets = Array.isArray(result) ? result : [result];
  const document = resultSets
    .flatMap((item) => item.rows || [])
    .map(phaseDocument)
    .find(Boolean);
  if (!document?.pass)
    throw new Error(`DBREAL_${phase.toUpperCase()}_DID_NOT_PASS`);
  return document;
}

async function waitForEvolutionRpcInPostgrest(service) {
  const probe = {
    p_cliente_id: randomUUID(),
    p_empleado_id: randomUUID(),
    p_workday_date: "2030-01-01",
    p_schedule_id: randomUUID(),
    p_timezone: "America/Cancun",
    p_first_in: null,
    p_last_out: null,
    p_worked_minutes: 0,
    p_break_minutes: 0,
    p_overtime_minutes: 0,
    p_late_minutes: 0,
    p_early_leave_minutes: 0,
    p_status: "INCOMPLETE",
    p_integrity_hash: "dbreal-schema-cache-probe",
    p_calculation_version: 3,
    p_registro_id: randomUUID(),
    p_source_observed_at: "2030-01-01T00:00:00.000Z",
    p_source_event_count: 1,
  };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { error } = await service.rpc("upsert_workday_record", probe);
    // Any semantic RPC response proves PostgREST has loaded the 18-argument
    // signature. PGRST202 is the only expected transient cache response.
    if (error?.code !== "PGRST202") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("DBREAL_POSTGREST_SCHEMA_CACHE_RELOAD_TIMEOUT");
}

export async function assertPersistGateClosed(client) {
  const { rows } = await client.query(`
    SELECT count(*)::integer AS count
    FROM public.tenant_features
    WHERE feature_key='WORKDAY_PERSIST_ACTIVE' AND enabled IS TRUE
  `);
  if (rows[0].count !== 0)
    throw new Error("DBREAL_PERSIST_GATE_MUST_START_CLOSED");
}

export async function enableFixturePersistGate(client, tenantId) {
  const result = await client.query(
    `
    INSERT INTO public.tenant_features(cliente_id,feature_key,mode,enabled,canary_registro_id,canary_empleado_id,canary_schedule_id,canary_workday_date)
    VALUES($1,'WORKDAY_PERSIST_ACTIVE','PERSIST_ACTIVE',true,NULL,NULL,NULL,NULL)
    ON CONFLICT (cliente_id,feature_key) DO UPDATE SET mode='PERSIST_ACTIVE',enabled=true,
      canary_registro_id=NULL,canary_empleado_id=NULL,canary_schedule_id=NULL,canary_workday_date=NULL
  `,
    [tenantId],
  );
  if (result.rowCount !== 1)
    throw new Error("DBREAL_FIXTURE_GATE_ENABLE_FAILED");
}

export async function disableFixturePersistGate(client, tenantId) {
  await client.query(
    `DELETE FROM public.tenant_features WHERE cliente_id=$1 AND feature_key='WORKDAY_PERSIST_ACTIVE'`,
    [tenantId],
  );
}

async function insert(client, sql, values) {
  const { rows } = await client.query(sql, values);
  return rows[0];
}

function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

const daysConfig = Object.freeze({
  lun: { activo: true, entrada: "09:00", salida: "18:00" },
  mar: { activo: true, entrada: "09:00", salida: "18:00" },
  mie: { activo: true, entrada: "09:00", salida: "18:00" },
  jue: { activo: true, entrada: "09:00", salida: "18:00" },
  vie: { activo: true, entrada: "09:00", salida: "18:00" },
  sab: { activo: false },
  dom: { activo: false },
});

export async function createWorkdayEvolutionFixture(client) {
  const suffix = randomUUID().slice(0, 12);
  const tenantA = await insert(
    client,
    `INSERT INTO public.clientes(nombre_empresa) VALUES($1) RETURNING id`,
    [`DBWE A ${suffix}`],
  );
  const tenantB = await insert(
    client,
    `INSERT INTO public.clientes(nombre_empresa) VALUES($1) RETURNING id`,
    [`DBWE B ${suffix}`],
  );
  const employee = await insert(
    client,
    `
  INSERT INTO public.empleados(
    cliente_id,
    device_userid,
    nombre,
    apellido,
    clave_empleado,
    activo
  )
  VALUES($1,$2,'DBWE','Employee',$3,true)
  RETURNING id,device_userid
`,
    [tenantA.id, `DBWE-${suffix}`, `dbwe-${suffix}`],
  );

  const employeeB = await insert(
    client,
    `
  INSERT INTO public.empleados(
    cliente_id,
    device_userid,
    nombre,
    apellido,
    clave_empleado,
    activo
  )
  VALUES($1,$2,'DBWE','Employee B',$3,true)
  RETURNING id,device_userid
`,
    [tenantB.id, `DBWEB-${suffix}`, `dbwe-b-${suffix}`],
  );
  const deviceA = await insert(
    client,
    `
    INSERT INTO public.devices(cliente_id,serial_number,timezone,is_active,name)
    VALUES($1,$2,'America/Cancun',true,$3) RETURNING id,serial_number
  `,
    [tenantA.id, `DBWE-A-${suffix}`, `DBWE device A ${suffix}`],
  );
  const deviceB = await insert(
    client,
    `
    INSERT INTO public.devices(cliente_id,serial_number,timezone,is_active,name)
    VALUES($1,$2,'America/Cancun',true,$3) RETURNING id,serial_number
  `,
    [tenantB.id, `DBWE-B-${suffix}`, `DBWE device B ${suffix}`],
  );
  const schedule = await insert(
    client,
    `
    INSERT INTO public.horarios(cliente_id,nombre,dias_config,tolerancia_minutos,activo)
    VALUES($1,$2,$3::jsonb,10,true) RETURNING id
  `,
    [tenantA.id, `DBWE schedule ${suffix}`, JSON.stringify(daysConfig)],
  );
  const revisionSnapshot = {
    calculation_contract_version: 1,
    dias_config: daysConfig,
    tolerancia_minutos: 10,
    horario_activo: true,
  };
  const revisionHash = await insert(
    client,
    `SELECT public.schedule_revision_calculation_hash($1::jsonb) AS integrity_hash`,
    [JSON.stringify(revisionSnapshot)],
  );
  const revision = await insert(
    client,
    `
    INSERT INTO public.schedule_revisions(cliente_id,horario_id,version,effective_from,config_snapshot,integrity_hash,reason)
    VALUES($1,$2,1,'2030-01-01',$3::jsonb,$4,'DBREAL_WORKDAY_EVOLUTION_FIXTURE') RETURNING id
  `,
    [
      tenantA.id,
      schedule.id,
      JSON.stringify(revisionSnapshot),
      revisionHash.integrity_hash,
    ],
  );
  const assignment = await insert(
    client,
    `
    INSERT INTO public.empleados_horarios(cliente_id,empleado_id,horario_id,fecha_inicio,activo,schedule_revision_id)
    VALUES($1,$2,$3,'2030-01-01',true,$4) RETURNING id
  `,
    [tenantA.id, employee.id, schedule.id, revision.id],
  );
  return {
    suffix,
    tenantA,
    tenantB,
    employee,
    employeeB,
    deviceA,
    deviceB,
    schedule,
    revision,
    assignment,
  };
}

export async function createCanonicalRegistro(
  client,
  fixture,
  {
    tenant = fixture.tenantA,
    employee = fixture.employee,
    device = fixture.deviceA,
    occurredAt,
    sourceType = "ZKTECO",
    processingStatus = "PROCESSED",
    withSource = true,
  } = {},
) {
  if (!withSource) {
    return insert(
      client,
      `
      INSERT INTO public.registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload)
      VALUES($1,$2,$3,$4,'entrada','huella',false,'{}'::jsonb) RETURNING id
    `,
      [tenant.id, employee.id, device.id, occurredAt],
    );
  }
  const log = await insert(
    client,
    `
    INSERT INTO public.attendance_logs(device_serial,user_id,timestamp,status,verify_type,metodo)
    VALUES($1,$2,$3,'dbreal-canonical-source',1,'huella') RETURNING id
  `,
    // Do not use a fixture employee's device_userid. The legacy ATTLOG trigger
    // would otherwise manufacture a second, unrelated registro_asistencia.
    [device.serial_number, `dbwe-source-${fixture.suffix}`, occurredAt],
  );
  const source = await insert(
    client,
    `
    INSERT INTO public.attendance_source_events(cliente_id,employee_id,device_id,source_type,source_reference,occurred_at,processing_status,raw_payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id
  `,
    [
      tenant.id,
      employee.id,
      device.id,
      sourceType,
      sourceType === "ZKTECO" ? log.id : null,
      occurredAt,
      processingStatus,
      JSON.stringify({
        source: "dbreal-workday-evolution",
        source_log_id: log.id,
      }),
    ],
  );
  return insert(
    client,
    `
    INSERT INTO public.registro_asistencia(cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload,source_event_id)
    VALUES($1,$2,$3,$4,'entrada','huella',false,$5::jsonb,$6) RETURNING id
  `,
    [
      tenant.id,
      employee.id,
      device.id,
      occurredAt,
      JSON.stringify({
        source: "dbreal-workday-evolution",
        source_log_id: log.id,
      }),
      source.id,
    ],
  );
}

export function evolutionPayload(fixture, registroId, overrides = {}) {
  const snapshot = {
    cliente_id: fixture.tenantA.id,
    empleado_id: fixture.employee.id,
    workday_date: "2030-06-10",
    schedule_id: fixture.schedule.id,
    timezone: "America/Cancun",
    first_in: "2030-06-10T14:00:00.000Z",
    last_out: null,
    worked_minutes: 0,
    break_minutes: 0,
    overtime_minutes: 0,
    late_minutes: 0,
    early_leave_minutes: 0,
    status: "INCOMPLETE",
    calculation_version: 3,
    registro_id: registroId,
    source_observed_at: "2030-06-10T14:00:00.000Z",
    source_event_count: 1,
    ...overrides,
  };
  return {
    ...snapshot,
    integrity_hash: snapshot.integrity_hash || snapshotHash(snapshot),
  };
}

export async function callWorkdayEvolution(service, payload) {
  const { data, error } = await service.rpc("upsert_workday_record", {
    p_cliente_id: payload.cliente_id,
    p_empleado_id: payload.empleado_id,
    p_workday_date: payload.workday_date,
    p_schedule_id: payload.schedule_id,
    p_timezone: payload.timezone,
    p_first_in: payload.first_in,
    p_last_out: payload.last_out,
    p_worked_minutes: payload.worked_minutes,
    p_break_minutes: payload.break_minutes,
    p_overtime_minutes: payload.overtime_minutes,
    p_late_minutes: payload.late_minutes,
    p_early_leave_minutes: payload.early_leave_minutes,
    p_status: payload.status,
    p_integrity_hash: payload.integrity_hash,
    p_calculation_version: payload.calculation_version,
    p_registro_id: payload.registro_id,
    p_source_observed_at: payload.source_observed_at,
    p_source_event_count: payload.source_event_count,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function workdayState(
  client,
  fixture,
  workdayDate = "2030-06-10",
) {
  const { rows } = await client.query(
    `
    SELECT w.*, (SELECT count(*)::integer FROM public.workday_record_history h WHERE h.workday_record_id=w.id) AS history_count,
      (SELECT action FROM public.workday_record_history h WHERE h.workday_record_id=w.id ORDER BY h.persisted_at DESC,id DESC LIMIT 1) AS last_history_action
    FROM public.workday_records w WHERE w.cliente_id=$1 AND w.empleado_id=$2 AND w.workday_date=$3
  `,
    [fixture.tenantA.id, fixture.employee.id, workdayDate],
  );
  return rows[0] || null;
}

export async function assertFunctionPrivileges(client) {
  const { rows } = await client.query(
    `
    SELECT has_function_privilege('anon',$1::regprocedure,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role',$1::regprocedure,'EXECUTE') AS service_role_execute,
      EXISTS(
        SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid=$1::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ) AS public_execute,
      has_function_privilege('service_role',$2::regprocedure,'EXECUTE') AS legacy_service_role_execute
  `,
    [RPC_18, RPC_16],
  );
  return rows[0];
}

export async function cleanupWorkdayEvolutionFixture(client, fixture) {
  if (!fixture) return;
  await disableFixturePersistGate(client, fixture.tenantA.id);
  await client.query(
    `DELETE FROM public.attendance_persist_outbox WHERE cliente_id IN ($1,$2)`,
    [fixture.tenantA.id, fixture.tenantB.id],
  );
  await client.query(
    `DELETE FROM public.workday_record_history WHERE cliente_id IN ($1,$2)`,
    [fixture.tenantA.id, fixture.tenantB.id],
  );
  await client.query(
    `DELETE FROM public.workday_records WHERE cliente_id IN ($1,$2)`,
    [fixture.tenantA.id, fixture.tenantB.id],
  );
  await client.query(
    `DELETE FROM public.registro_asistencia WHERE cliente_id IN ($1,$2)`,
    [fixture.tenantA.id, fixture.tenantB.id],
  );
  await client.query(
    `DELETE FROM public.attendance_source_events WHERE cliente_id IN ($1,$2)`,
    [fixture.tenantA.id, fixture.tenantB.id],
  );
  await client.query(
    `DELETE FROM public.attendance_logs WHERE device_serial IN ($1,$2)`,
    [fixture.deviceA.serial_number, fixture.deviceB.serial_number],
  );
  // schedule_revisions is intentionally immutable. The isolated audit role is
  // required to be able to clean only these UUID-generated fixture rows after
  // the contract checks have completed; session_replication_role is local to
  // this cleanup transaction and never used by production code.
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL session_replication_role = replica`);
    await client.query(
      `DELETE FROM public.empleados_horarios WHERE cliente_id=$1`,
      [fixture.tenantA.id],
    );
    await client.query(
      `DELETE FROM public.schedule_revisions WHERE cliente_id=$1`,
      [fixture.tenantA.id],
    );
    await client.query(`DELETE FROM public.horarios WHERE cliente_id=$1`, [
      fixture.tenantA.id,
    ]);
    await client.query(
      `DELETE FROM public.devices WHERE cliente_id IN ($1,$2)`,
      [fixture.tenantA.id, fixture.tenantB.id],
    );
    await client.query(
      `DELETE FROM public.empleados WHERE cliente_id IN ($1,$2)`,
      [fixture.tenantA.id, fixture.tenantB.id],
    );
    await client.query(`DELETE FROM public.clientes WHERE id IN ($1,$2)`, [
      fixture.tenantA.id,
      fixture.tenantB.id,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function prepareWorkdayEvolutionDbreal() {
  const config = workdayEvolutionDbrealConfig();
  if (!config.ready) throw new Error(config.skipReason);
  const client = await postgresAdminClient(config);
  try {
    await assertPersistGateClosed(client);
    const precheck = await runPhaseAndRequirePass(client, "precheck");
    await runPhase(client, "change");
    await client.query(`SELECT pg_notify('pgrst','reload schema')`);
    const postcheck = await runPhaseAndRequirePass(client, "postcheck");
    const service = createClient(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await waitForEvolutionRpcInPostgrest(service);
    const fixture = await createWorkdayEvolutionFixture(client);
    await enableFixturePersistGate(client, fixture.tenantA.id);
    return { client, config, fixture, service, precheck, postcheck };
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function closeWorkdayEvolutionDbreal(context) {
  if (!context?.client) return;
  try {
    await cleanupWorkdayEvolutionFixture(context.client, context.fixture);
  } finally {
    await context.client.end();
  }
}
