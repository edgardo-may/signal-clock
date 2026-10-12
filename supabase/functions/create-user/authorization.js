// Authorization uses the authenticated caller's database profile, never request metadata.
export function resolveUserCreationTenant(profile, requestedTenant) {
  if (!profile || (profile.estatus_cuenta && profile.estatus_cuenta !== 'activo')) {
    throw new Error('La cuenta no está autorizada para crear usuarios.')
  }
  const role = String(profile.rol || '').toLowerCase()
  if (role === 'superadmin') {
    if (!requestedTenant) throw new Error('Selecciona la empresa del nuevo usuario.')
    return requestedTenant
  }
  if (role !== 'admin' || !profile.cliente_id) {
    throw new Error('Solo los administradores pueden crear usuarios de empresa.')
  }
  if (requestedTenant && requestedTenant !== profile.cliente_id) {
    throw new Error('No puedes crear usuarios en otra empresa.')
  }
  return profile.cliente_id
}
