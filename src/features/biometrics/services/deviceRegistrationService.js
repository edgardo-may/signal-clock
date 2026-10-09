import { supabase } from '../../../lib/supabase'

async function result(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

export const deviceRegistrationService = {
  list(clienteId) {
    let query = supabase.from('device_registration_requests')
      .select('*, clientes(nombre_empresa), requester:usuarios_perfiles!requested_by(nombre), resolver:usuarios_perfiles!resolved_by(nombre)')
      .order('requested_at', { ascending: false })
    if (clienteId) query = query.eq('cliente_id', clienteId)
    return result(query)
  },
  request(form, targetClienteId) {
    return result(supabase.rpc('request_device_registration', {
      p_serial: form.serial_number, p_name: form.name, p_protocol: form.protocol,
      p_timezone: form.timezone, p_location: form.location || null,
      p_device_type: form.device_type || 'general', p_target_cliente_id: targetClienteId || null,
    }))
  },
  resolve(id, decision, reason) {
    return result(supabase.rpc('resolve_device_registration', {
      p_request_id: id, p_decision: decision, p_reason: reason || null,
    }))
  },
  cancel(id, reason) {
    return result(supabase.rpc('cancel_device_registration', { p_request_id: id, p_reason: reason || null }))
  },
}
