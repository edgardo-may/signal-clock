import type { AuthIdentity } from '../../auth/AuthProvider.js';
import type { TenantResolver } from '../../auth/TenantResolver.js';
import type { TenantContext } from '../../types/RequestContext.js';
import { ApiError } from '../../errors.js';
import { PostgresConnection } from './connection.js';

export class PostgresTenantResolver implements TenantResolver {
  constructor(private readonly db: PostgresConnection) {}
  resolve(identity: AuthIdentity): Promise<TenantContext> {
    return this.db.transaction(identity.userId, async client => {
      const { rows } = await this.db.query<{ cliente_id: string | null; rol: string; estatus_cuenta: string }>(client,
        'SELECT cliente_id, rol, estatus_cuenta FROM public.usuarios_perfiles WHERE id = $1', [identity.userId]);
      const profile = rows[0];
      if (!profile || profile.estatus_cuenta !== 'activo' || !profile.cliente_id || !profile.rol) {
        throw new ApiError(403, 'TENANT_CONTEXT_UNAVAILABLE');
      }
      // Global superadmin tenant switching stays on the legacy path in this canary.
      if (profile.rol.toLowerCase() === 'superadmin') throw new ApiError(403, 'GLOBAL_ADMIN_REQUIRES_LEGACY');
      const { rows: permissions } = await this.db.query<{ disabled: boolean }>(client, `
        SELECT EXISTS (SELECT 1 FROM public.cliente_modulos WHERE cliente_id = $1
          AND module_key = 'employees' AND habilitado = false)
          OR EXISTS (SELECT 1 FROM public.user_module_permissions WHERE user_id = $2
          AND module_key = 'employees' AND allowed = false) AS disabled`, [profile.cliente_id, identity.userId]);
      if (permissions[0]?.disabled) throw new ApiError(403, 'EMPLOYEE_MODULE_DISABLED');
      return Object.freeze({ userId: identity.userId, tenantId: profile.cliente_id, role: profile.rol.toLowerCase() });
    });
  }
}
