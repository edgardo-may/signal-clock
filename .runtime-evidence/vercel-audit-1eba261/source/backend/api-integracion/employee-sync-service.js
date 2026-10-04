'use strict'

const { createClient } = require('@supabase/supabase-js')
const { fetchEmpleados } = require('./consolide-client')

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY')
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function normalizeEmpleado(ext, clienteId) {
  const apellidoPaterno = (ext.paterno || '').trim()
  const apellidoMaterno = (ext.materno || '').trim()
  return {
    cliente_id: clienteId,
    clave_empleado: String(ext.trab_ID),
    nombre: (ext.nombre || '').trim(),
    apellido: [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' '),
    apellido_paterno: apellidoPaterno || null,
    apellido_materno: apellidoMaterno || null,
    departamento: ext.departamento || null,
    puesto: ext.puesto || null,
    curp: ext.curp || null,
    rfc: ext.rfc || null,
    activo: (ext.estatus || '').toLowerCase() === 'activo',
  }
}

function hasChanges(local, normalized) {
  const fields = [
    'nombre', 'apellido', 'apellido_paterno', 'apellido_materno',
    'departamento', 'puesto', 'curp', 'rfc', 'activo',
  ]
  return fields.some((field) => (local[field] ?? null) !== (normalized[field] ?? null))
}

async function syncEmpleados({ clienteId, fechaInicio, fechaFin, trabId, dryRun = false }) {
  const startTime = Date.now()
  const result = {
    dryRun,
    consultados: 0,
    nuevos: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: 0,
    preview: [],
    erroresList: [],
    duracionMs: 0,
  }

  const supabase = getSupabase()
  const { data: tenantData, error: tenantError } = await supabase
    .from('clientes')
    .select('id_empresa')
    .eq('id', clienteId)
    .single()

  if (tenantError || !tenantData) {
    throw new Error(`Error al validar el tenant actual: ${tenantError?.message || 'No encontrado'}`)
  }
  if (!tenantData.id_empresa) {
    throw new Error('El sistema no puede sincronizar: Esta empresa no tiene un IDEmpresa de Consolide configurado. Asigna el ID en el Panel Central.')
  }

  let externos = await fetchEmpleados({
    idEmpresa: tenantData.id_empresa,
    fechaInicio,
    fechaFin,
    trabId,
  })
  if (!trabId) externos = externos.filter((ext) => (ext.estatus || '').toLowerCase() === 'activo')

  result.consultados = externos.length
  if (externos.length === 0) {
    result.duracionMs = Date.now() - startTime
    return result
  }

  const { data: locales, error: dbError } = await supabase
    .from('empleados')
    .select('id, clave_empleado, nombre, apellido, apellido_paterno, apellido_materno, departamento, puesto, curp, rfc, activo')
    .eq('cliente_id', clienteId)
  if (dbError) throw new Error(`Error al leer colaboradores locales: ${dbError.message}`)

  const localMap = {}
  for (const empleado of locales || []) {
    if (empleado.clave_empleado) localMap[empleado.clave_empleado] = empleado
  }

  for (const ext of externos) {
    const extId = String(ext.trab_ID)
    const normalized = normalizeEmpleado(ext, clienteId)
    const local = localMap[extId]

    if (!local) {
      if (dryRun) {
        result.preview.push({
          trab_ID: extId,
          nombre: `${normalized.nombre} ${normalized.apellido}`,
          departamento: normalized.departamento,
          puesto: normalized.puesto,
          activo: normalized.activo,
          accion: 'crear',
        })
        result.nuevos++
        continue
      }

      const { error } = await supabase.from('empleados').insert(normalized)
      if (error) {
        result.errores++
        result.erroresList.push({ trab_ID: extId, error: error.message })
        console.error(`[SYNC] Error al crear empleado ${extId}:`, error.message)
      } else {
        result.nuevos++
        console.log(`[SYNC] Creado: trab_ID=${extId} nombre=${normalized.nombre}`)
      }
      continue
    }

    if (hasChanges(local, normalized)) {
      if (dryRun) {
        result.preview.push({
          trab_ID: extId,
          nombre: `${normalized.nombre} ${normalized.apellido}`,
          departamento: normalized.departamento,
          puesto: normalized.puesto,
          activo: normalized.activo,
          accion: 'actualizar',
        })
        result.actualizados++
        continue
      }

      const {
        nombre, apellido, apellido_paterno, apellido_materno,
        departamento, puesto, curp, rfc, activo,
      } = normalized
      const { error } = await supabase
        .from('empleados')
        .update({ nombre, apellido, apellido_paterno, apellido_materno, departamento, puesto, curp, rfc, activo })
        .eq('id', local.id)
        .eq('cliente_id', clienteId)
      if (error) {
        result.errores++
        result.erroresList.push({ trab_ID: extId, error: error.message })
        console.error(`[SYNC] Error al actualizar empleado ${extId}:`, error.message)
      } else {
        result.actualizados++
        console.log(`[SYNC] Actualizado: trab_ID=${extId} nombre=${normalized.nombre}`)
      }
      continue
    }

    if (dryRun) {
      result.preview.push({
        trab_ID: extId,
        nombre: `${normalized.nombre} ${normalized.apellido}`,
        departamento: normalized.departamento,
        puesto: normalized.puesto,
        activo: normalized.activo,
        accion: 'sin_cambios',
      })
    }
    result.sinCambios++
  }

  result.duracionMs = Date.now() - startTime
  console.log(`[SYNC] Completado | tenant:${clienteId} | consultados:${result.consultados} | nuevos:${result.nuevos} | actualizados:${result.actualizados} | sinCambios:${result.sinCambios} | errores:${result.errores} | duración:${result.duracionMs}ms`)
  return result
}

module.exports = { syncEmpleados, normalizeEmpleado, hasChanges }
