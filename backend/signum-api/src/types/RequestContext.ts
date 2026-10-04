export interface TenantContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
}

export interface RequestMetrics {
  queryCount: number;
  rowsReturned: number;
}

export interface RequestContext {
  requestId: string;
  metrics: RequestMetrics;
  tenant?: TenantContext;
  endpoint?: string;
}

declare global {
  namespace Express {
    interface Request { context: RequestContext }
  }
}
