import type { AuthIdentity } from './AuthProvider.js';
import type { TenantContext } from '../types/RequestContext.js';
export interface TenantResolver { resolve(identity: AuthIdentity): Promise<TenantContext> }
