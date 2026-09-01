// backend/employee-sync-service.js
// ─────────────────────────────────────────────────────────────────────────────
//  Servicio de sincronización de colaboradores Consolide → Supabase
//
//  Responsabilidades:
//   1. Consultar colaboradores de la API externa
//   2. Normalizar/mapear campos externos → esquema local
//   3. Comparar contra colaboradores existentes del tenant
//   4. Crear nuevos, actualizar existentes, detectar sin cambios
//   5. Generar resumen de sincronización
//   6. Nunca eliminar colaboradores automáticamente
//
//  MULTI-TENANT:
//   Todas las operaciones de DB están explícitamente filtradas por cliente_id.
//   El cliente_id es validado desde el JWT del usuario antes de llamar a este servicio.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { createClient } = require("@supabase/supabase-js");
const { fetchEmpleados } = require("./consolide-client");

// ── Supabase service role (bypass RLS controlado) ─────────────────────────────
// Usamos service_role ÚNICAMENTE en backend. Todas las queries llevan
// filtro explícito por cliente_id para garantizar aislamiento tenant.
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ── Mapeo: ExternalEmployee (Consolide) → Empleado local ─────────────────────
/**
 * Transforma un registro de la API Consolide al esquema de empleados de Supabase.
 *
 * Campos de la API:
 *   trab_ID, nombre, paterno, materno, curp, rfc,
 *   puesto_ID, puesto, depto_ID, departamento,
 *   centro_ID, centro, estatus, fecha_Movimiento,
 *   mov_ID, movimiento, motivo
 *
 * @param {object} ext  - Registro externo de Consolide
 * @param {string} clienteId
 * @returns {object} Payload para insertar/actualizar en tabla empleados
 */
function normalizeEmpleado(ext, clienteId) {
  const apellidoPaterno = (ext.paterno || "").trim();
  const apellidoMaterno = (ext.materno || "").trim();
  const apellidoCombinado = [apellidoPaterno, apellidoMaterno]
    .filter(Boolean)
    .join(" ");

  return {
    cliente_id: clienteId,
    clave_empleado: String(ext.trab_ID),
    nombre: (ext.nombre || "").trim(),
    apellido: apellidoCombinado,
    apellido_paterno: apellidoPaterno || null,
    apellido_materno: apellidoMaterno || null,
    departamento: ext.departamento || null,
    puesto: ext.puesto || null,
    curp: ext.curp || null,
    rfc: ext.rfc || null,
    activo: (ext.estatus || "").toLowerCase() === "activo",
  };
}

// ── Comparar si hay cambios entre local y externo ─────────────────────────────
function hasChanges(local, normalized) {
  const fields = [
    "nombre",
    "apellido",
    "apellido_paterno",
    "apellido_materno",
    "departamento",
    "puesto",
    "curp",
    "rfc",
    "activo",
  ];
  return fields.some((f) => (local[f] ?? null) !== (normalized[f] ?? null));
}

// ── Lógica de sincronización completa ────────────────────────────────────────
/**
 * @param {object} params
 * @param {string} params.clienteId      - UUID del tenant actual
 * @param {string} params.fechaInicio    - "YYYY-MM-DD"
 * @param {string} params.fechaFin       - "YYYY-MM-DD"
 * @param {string} [params.trabId]       - ID externo específico a sincronizar
 * @param {boolean} [params.dryRun=false] - solo previsualizar, no escribir
 * @returns {Promise<SyncResult>}
 */
async function syncEmpleados({
  clienteId,
  fechaInicio,
  fechaFin,
  trabId,
  dryRun = false,
}) {
  const startTime = Date.now();

  const result = {
    dryRun,
    consultados: 0,
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: 0,
    preview: [], // solo cuando dryRun=true
    erroresList: [],
    duracionMs: 0,
  };

  // 1. Obtener id_empresa del tenant actual en la base de datos
  const supabase = getSupabase();
  const { data: tenantData, error: tenantError } = await supabase
    .from("clientes")
    .select("id_empresa")
    .eq("id", clienteId)
    .single();

  if (tenantError || !tenantData) {
    throw new Error(
      `Error al validar el tenant actual: ${tenantError?.message || "No encontrado"}`,
    );
  }

  const idEmpresa = tenantData.id_empresa;
  if (!idEmpresa) {
    throw new Error(
      "El sistema no puede sincronizar: Esta empresa no tiene un IDEmpresa de Consolide configurado. Asigna el ID en el Panel Central.",
    );
  }

  // 2. Obtener colaboradores de la API externa usando el IDEmpresa dinámico
  let externos = await fetchEmpleados({
    idEmpresa,
    fechaInicio,
    fechaFin,
    trabId,
  });

  // Si es masiva (sin trabId específico), filtramos solo los activos
  if (!trabId) {
    externos = externos.filter(
      (ext) => (ext.estatus || "").toLowerCase() === "activo",
    );
  }

  result.consultados = externos.length;

  if (externos.length === 0) {
    result.duracionMs = Date.now() - startTime;
    return result;
  }

  // 3. Obtener colaboradores locales del tenant (solo los externos)
  const { data: locales, error: dbError } = await supabase
    .from("empleados")
    .select(
      "id, clave_empleado, hikvision_device_userid, nombre, apellido, apellido_paterno, apellido_materno, departamento, puesto, curp, rfc, activo",
    )
    .eq("cliente_id", clienteId);

  if (dbError)
    throw new Error(`Error al leer colaboradores locales: ${dbError.message}`);

  // 3. Indexar locales por clave_empleado para búsqueda O(1) y calcular maxBiometricId
  const localMap = {};
  let maxBiometricId = 0;

  for (const emp of locales || []) {
    if (emp.clave_empleado) {
      localMap[emp.clave_empleado] = emp;
    }
    const currentId = parseInt(emp.hikvision_device_userid, 10);
    if (!isNaN(currentId) && currentId > maxBiometricId) {
      maxBiometricId = currentId;
    }
  }

  // 4. Procesar cada colaborador externo
  for (const ext of externos) {
    const extId = String(ext.trab_ID);
    const normalized = normalizeEmpleado(ext, clienteId);
    const local = localMap[extId];

    if (!local) {
      // ── NUEVO ─────────────────────────────────────────────────────
      maxBiometricId++;
      const newBiometricId = String(maxBiometricId);

      if (dryRun) {
        result.preview.push({
          trab_ID: extId,
          nombre: `${normalized.nombre} ${normalized.apellido}`,
          departamento: normalized.departamento,
          puesto: normalized.puesto,
          activo: normalized.activo,
          accion: "crear",
        });
        result.nuevos++;
      } else {
        const { error } = await supabase.from("empleados").insert({
          ...normalized,
          hikvision_device_userid: newBiometricId,
          activo: normalized.activo,
        });

        if (error) {
          result.errores++;
          result.erroresList.push({ trab_ID: extId, error: error.message });
          console.error(
            `[SYNC] Error al crear empleado ${extId}:`,
            error.message,
          );
        } else {
          result.nuevos++;
          console.log(
            `[SYNC] Creado: trab_ID=${extId} nombre=${normalized.nombre} biometric_id=${newBiometricId}`,
          );
        }
      }
    } else if (hasChanges(local, normalized)) {
      // ── ACTUALIZAR ────────────────────────────────────────────────
      if (dryRun) {
        result.preview.push({
          trab_ID: extId,
          nombre: `${normalized.nombre} ${normalized.apellido}`,
          departamento: normalized.departamento,
          puesto: normalized.puesto,
          activo: normalized.activo,
          accion: "actualizar",
        });
        result.actualizados++;
      } else {
        const {
          nombre,
          apellido,
          apellido_paterno,
          apellido_materno,
          departamento,
          puesto,
          curp,
          rfc,
          activo,
        } = normalized;
        const { error } = await supabase
          .from("empleados")
          .update({
            nombre,
            apellido,
            apellido_paterno,
            apellido_materno,
            departamento,
            puesto,
            curp,
            rfc,
            activo,
          })
          .eq("id", local.id)
          .eq("cliente_id", clienteId);

        if (error) {
          result.errores++;
          result.erroresList.push({ trab_ID: extId, error: error.message });
          console.error(
            `[SYNC] Error al actualizar empleado ${extId}:`,
            error.message,
          );
        } else {
          result.actualizados++;
          console.log(
            `[SYNC] Actualizado: trab_ID=${extId} nombre=${normalized.nombre}`,
          );
        }
      }
    } else {
      // ── SIN CAMBIOS ───────────────────────────────────────────────
      if (dryRun) {
        result.preview.push({
          trab_ID: extId,
          nombre: `${normalized.nombre} ${normalized.apellido}`,
          departamento: normalized.departamento,
          puesto: normalized.puesto,
          activo: normalized.activo,
          accion: "sin_cambios",
        });
      }
      result.sinCambios++;
    }
  }

  result.duracionMs = Date.now() - startTime;

  // Log de auditoría (SIN token, SIN secretos)
  console.log(
    `[SYNC] Completado | tenant:${clienteId} | consultados:${result.consultados} | nuevos:${result.nuevos} | actualizados:${result.actualizados} | sinCambios:${result.sinCambios} | errores:${result.errores} | duración:${result.duracionMs}ms`,
  );

  return result;
}

module.exports = { syncEmpleados, normalizeEmpleado, hasChanges };
