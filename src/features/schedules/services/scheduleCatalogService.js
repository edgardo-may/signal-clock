import { supabase } from '../../../lib/supabase'

export async function applyScheduleCatalogRevision({ clienteId, action, horarioId = null, nombre, descripcion, color, diasConfig, toleranciaMinutos, effectiveDate, reason }) {
  const snapshot = {
    calculation_contract_version: 1,
    dias_config: diasConfig,
    tolerancia_minutos: toleranciaMinutos,
    horario_activo: action !== 'DISABLE',
  }
  const { data, error } = await supabase.rpc('apply_schedule_catalog_revision', {
    p_cliente_id: clienteId,
    p_action: action,
    p_horario_id: horarioId,
    p_nombre: nombre,
    p_descripcion: descripcion,
    p_color: color,
    p_snapshot: snapshot,
    p_effective_date: effectiveDate,
    p_reason: reason,
    p_correlation_id: globalThis.crypto.randomUUID(),
  })
  if (error) throw new Error(scheduleErrorMessage(error.message))
  return data
}

export function scheduleErrorMessage(message = '') {
  if (message.includes('SCHEDULE_DELETE_FORBIDDEN')) return 'Sólo admin de la empresa y superadmin pueden eliminar horarios.'
  if (message.includes('SCHEDULE_DELETE_HAS_ACTIVE_ASSIGNMENTS')) return 'El horario tiene asignaciones vigentes o futuras. Ciérralas antes de eliminarlo del catálogo.'
  if (message.includes('SCHEDULE_ARCHIVED')) return 'Este horario fue eliminado del catálogo y se conserva únicamente para el historial.'
  if (message.includes('SCHEDULE_START_ALREADY_ELAPSED')) return 'La hora de entrada ya pasó en America/Cancun. Elige una hora futura o una fecha posterior.'
  if (message.includes('SCHEDULE_TODAY_HAS_NO_ACTIVE_ENTRY')) return 'Activa el día de hoy e indica su hora de entrada para iniciar la vigencia hoy.'
  if (message.includes('SCHEDULE_REVISION_REQUIRED_FOR_ACTIVE_ASSIGNMENT')) return 'El horario no tiene una revisión vigente para esa fecha. Créalo desde el catálogo revisionado.'
  return message
}

export async function archiveSchedule(scheduleId, reason) {
  const { data, error } = await supabase.rpc('archive_schedule', {
    p_schedule_id: scheduleId,
    p_reason: reason,
    p_correlation_id: globalThis.crypto.randomUUID(),
  })
  if (error) throw new Error(scheduleErrorMessage(error.message))
  return data
}
