import { supabase } from '../../../lib/supabase'
import { scheduleErrorMessage } from './scheduleCatalogService'

function correlationId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Este navegador no puede generar un correlation_id seguro.')
  }
  return globalThis.crypto.randomUUID()
}

async function invokeLifecycle(payload) {
  const { data, error } = await supabase.rpc('apply_employee_schedule_lifecycle', {
    p_cliente_id: payload.clienteId,
    p_empleado_ids: payload.empleadoIds,
    p_action: payload.action,
    p_horario_id: payload.horarioId ?? null,
    p_effective_date: payload.effectiveDate,
    p_fecha_fin: payload.fechaFin ?? null,
    p_assignment_id: payload.assignmentId ?? null,
    p_reason: payload.reason,
    p_correlation_id: payload.correlationId ?? correlationId(),
    p_retroactive_confirmed: payload.retroactiveConfirmed ?? false,
    p_preview_only: payload.previewOnly ?? false,
  })
  if (error) throw new Error(scheduleErrorMessage(error.message))
  return data
}

export const scheduleLifecycleService = {
  assignOrReplace: (payload) => invokeLifecycle({ ...payload, action: 'ASSIGN_OR_REPLACE' }),
  close: (payload) => invokeLifecycle({ ...payload, action: 'CLOSE' }),
  void: (payload) => invokeLifecycle({ ...payload, action: 'VOID' }),
}
