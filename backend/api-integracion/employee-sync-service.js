"use strict";

const { createClient } = require("@supabase/supabase-js");
const { fetchEmpleados } = require("./consolide-client");

const PAGE_SIZE = 1000;
// 'omitir': si hay un colaborador local sin clave (o con otra clave) con el mismo nombre,
//           NO se crea y se reporta en posiblesDuplicados. 'crear': se crea de todos modos.
const DUP_POLICY = (
  process.env.SYNC_DUPLICATE_POLICY || "omitir"
).toLowerCase();

// Campos que la fuente externa puede actualizar en un colaborador existente.
// NUNCA se tocan: device_userid, pin (contraseña portal), clave_empleado, activo.
const SYNC_FIELDS = [
  "nombre",
  "apellido",
  "apellido_paterno",
  "apellido_materno",
  "departamento",
  "puesto",
  "curp",
  "rfc",
];

const running = new Set(); // guarda en memoria; con varias instancias usar un lock en BD

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ── Normalización ──────────────────────────────────────────────
const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};
const claveKey = (value) => {
  const text = clean(value);
  return text ? text.toLowerCase() : null;
};
const nameKey = (nombre, apellido) =>
  `${nombre || ""} ${apellido || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const isActivoExterno = (ext) => (ext.estatus || "").toLowerCase() === "activo";

function normalizeEmpleado(ext, clienteId) {
  const paterno = clean(ext.paterno);
  const materno = clean(ext.materno);
  return {
    cliente_id: clienteId,
    clave_empleado: clean(ext.trab_ID),
    nombre: clean(ext.nombre),
    apellido: [paterno, materno].filter(Boolean).join(" ") || null,
    apellido_paterno: paterno,
    apellido_materno: materno,
    departamento: clean(ext.departamento),
    puesto: clean(ext.puesto),
    curp: clean(ext.curp),
    rfc: clean(ext.rfc),
  };
}

// Solo campos que la fuente externa SÍ trae y que difieren. Un valor externo vacío
// nunca borra lo que RH capturó a mano.
function buildPatch(local, normalized) {
  const patch = {};
  for (const field of SYNC_FIELDS) {
    const next = normalized[field];
    if (next !== null && clean(local[field]) !== next) patch[field] = next;
  }
  return patch;
}

function hasChanges(local, normalized) {
  return Object.keys(buildPatch(local, normalized)).length > 0;
}

// ── Lectura de locales (paginada: PostgREST corta en 1000 filas) ──
async function fetchLocales(supabase, clienteId) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("empleados")
      .select(
        "id, clave_empleado, device_userid, nombre, apellido, apellido_paterno, apellido_materno, departamento, puesto, curp, rfc, activo",
      )
      .eq("cliente_id", clienteId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error)
      throw new Error(`Error al leer colaboradores locales: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return all;
  }
}

async function syncEmpleados(params) {
  const { clienteId } = params;
  if (running.has(clienteId)) {
    throw new Error(
      "Ya hay una sincronización en curso para esta empresa. Intenta en unos minutos.",
    );
  }
  running.add(clienteId);
  try {
    return await runSync(params);
  } finally {
    running.delete(clienteId);
  }
}

async function runSync({
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
    omitidosInactivos: 0,
    omitidosPorLimite: 0,
    conflictos: 0,
    errores: 0,
    posiblesDuplicados: [], // manual sin clave/otra clave con el mismo nombre: requiere revisión de RH
    pendientesBaja: [], // inactivo en origen, activo local (no se modifica)
    pendientesReactivacion: [], // activo en origen, inactivo local (no se modifica)
    preview: [],
    erroresList: [],
    duracionMs: 0,
  };

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
  if (!tenantData.id_empresa) {
    throw new Error(
      "El sistema no puede sincronizar: Esta empresa no tiene un IDEmpresa de Consolide configurado. Asigna el ID en el Panel Central.",
    );
  }

  const externos = await fetchEmpleados({
    idEmpresa: tenantData.id_empresa,
    fechaInicio,
    fechaFin,
    trabId,
  });
  result.consultados = externos.length;
  if (externos.length === 0) {
    result.duracionMs = Date.now() - startTime;
    return result;
  }

  const locales = await fetchLocales(supabase, clienteId);

  const localMap = new Map(); // claveKey -> [locales]
  const nameMap = new Map(); // nameKey  -> [locales]
  for (const emp of locales) {
    const key = claveKey(emp.clave_empleado);
    if (key) localMap.set(key, [...(localMap.get(key) || []), emp]);
    const nk = nameKey(emp.nombre, emp.apellido);
    if (nk) nameMap.set(nk, [...(nameMap.get(nk) || []), emp]);
  }
  const externalKeys = new Set(
    externos.map((e) => claveKey(e.trab_ID)).filter(Boolean),
  );

  const fail = (label, message) => {
    result.errores++;
    result.erroresList.push({ ...label, error: message });
    console.error(`[SYNC] ${label.trab_ID || "s/clave"}: ${message}`);
  };
  const addPreview = (accion, label, extra = {}) => {
    if (dryRun) result.preview.push({ ...label, accion, ...extra });
  };

  const seen = new Set();
  let limiteAlcanzado = false;

  for (const ext of externos) {
    const normalized = normalizeEmpleado(ext, clienteId);
    const key = claveKey(normalized.clave_empleado);
    const label = {
      trab_ID: normalized.clave_empleado,
      nombre: `${normalized.nombre || ""} ${normalized.apellido || ""}`.trim(),
      departamento: normalized.departamento,
      puesto: normalized.puesto,
    };

    if (!key || !normalized.nombre) {
      fail(label, "Registro externo sin trab_ID o sin nombre");
      continue;
    }
    if (seen.has(key)) {
      fail(label, "trab_ID repetido en la respuesta externa");
      continue;
    }
    seen.add(key);

    const activoExterno = isActivoExterno(ext);
    const coincidencias = localMap.get(key) || [];

    // ── Ya existe (alta manual o sincronizada antes) ──
    if (coincidencias.length > 1) {
      fail(
        label,
        "Hay más de un colaborador local con esta clave; revisar duplicados",
      );
      continue;
    }
    if (coincidencias.length === 1) {
      const local = coincidencias[0];

      if (!activoExterno && local.activo) result.pendientesBaja.push(label);
      else if (activoExterno && !local.activo)
        result.pendientesReactivacion.push(label);

      const patch = buildPatch(local, normalized);
      if (Object.keys(patch).length === 0) {
        result.sinCambios++;
        addPreview("sin_cambios", label);
        continue;
      }
      if (dryRun) {
        result.actualizados++;
        addPreview("actualizar", label, { cambios: Object.keys(patch) });
        continue;
      }
      const { error } = await supabase
        .from("empleados")
        .update({ ...patch, actualizado_at: new Date().toISOString() })
        .eq("id", local.id)
        .eq("cliente_id", clienteId);
      if (error) fail(label, error.message);
      else {
        result.actualizados++;
        console.log(
          `[SYNC] Actualizado: trab_ID=${label.trab_ID} campos=${Object.keys(patch).join(",")}`,
        );
      }
      continue;
    }

    // ── No existe: alta ──
    if (!activoExterno) {
      result.omitidosInactivos++;
      addPreview("omitir_inactivo", label);
      continue;
    }

    if (DUP_POLICY === "omitir") {
      const candidatos = (
        nameMap.get(nameKey(normalized.nombre, normalized.apellido)) || []
      ).filter((l) => {
        const k = claveKey(l.clave_empleado);
        return !k || !externalKeys.has(k);
      });
      if (candidatos.length > 0) {
        result.posiblesDuplicados.push({
          ...label,
          coincideCon: candidatos.map((c) => ({
            id: c.id,
            clave_empleado: c.clave_empleado,
            device_userid: c.device_userid,
          })),
        });
        addPreview("posible_duplicado", label);
        continue;
      }
    }

    if (limiteAlcanzado) {
      result.omitidosPorLimite++;
      addPreview("omitir_limite", label);
      continue;
    }
    if (dryRun) {
      result.nuevos++;
      addPreview("crear", label);
      continue;
    }

    const { cliente_id: _omit, ...row } = normalized;
    const { data, error } = await supabase.rpc("fn_employee_insert_sync", {
      p_cliente_id: clienteId,
      p_row: row,
    });
    if (error) {
      if (error.code === "23505") {
        result.conflictos++;
        console.warn(
          `[SYNC] Conflicto (creado en paralelo): trab_ID=${label.trab_ID}`,
        );
      } else fail(label, error.message);
    } else if (data?.result === "CREATED") {
      result.nuevos++;
      console.log(
        `[SYNC] Creado: trab_ID=${label.trab_ID} device_userid=${data.device_userid}`,
      );
    } else if (data?.result === "LIMIT") {
      limiteAlcanzado = true;
      result.omitidosPorLimite++;
    } else if (data?.result === "EXISTS") {
      result.conflictos++;
    } else {
      fail(
        label,
        `Respuesta inesperada de fn_employee_insert_sync: ${JSON.stringify(data)}`,
      );
    }
  }

  result.duracionMs = Date.now() - startTime;
  console.log(
    `[SYNC] Completado | tenant:${clienteId} | consultados:${result.consultados} | nuevos:${result.nuevos} | ` +
      `actualizados:${result.actualizados} | sinCambios:${result.sinCambios} | limite:${result.omitidosPorLimite} | ` +
      `duplicados?:${result.posiblesDuplicados.length} | conflictos:${result.conflictos} | errores:${result.errores} | ${result.duracionMs}ms`,
  );
  return result;
}

module.exports = { syncEmpleados, normalizeEmpleado, hasChanges };
