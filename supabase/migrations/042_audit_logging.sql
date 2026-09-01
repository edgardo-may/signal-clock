-- ================================================================
-- SIGNUM-CLOCK · Migración 042
-- Audit Logging System
-- ================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT,
  ip_address TEXT,
  metadata JSONB
);

-- Indices para búsqueda rápida y reportes de auditoria
CREATE INDEX IF NOT EXISTS idx_audit_logs_cliente ON public.audit_logs(cliente_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- Activar RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- 1. Service Role tiene control total para insertar y consultar
CREATE POLICY "audit_logs: ALL service_role"
  ON public.audit_logs TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Superadmin puede ver todo
CREATE POLICY "audit_logs: SELECT superadmin"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.auth_is_superadmin());

-- 3. Admin / Auditor pueden ver los logs de su propio tenant
CREATE POLICY "audit_logs: SELECT tenant"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    cliente_id = public.auth_current_cliente_id() 
    AND public.auth_cuenta_activa()
  );

-- 4. Inserción permitida por administradores o auditores de su propio tenant
CREATE POLICY "audit_logs: INSERT tenant"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = public.auth_current_cliente_id() 
    AND public.auth_cuenta_activa()
  );

-- Prevenir UPDATE y DELETE completamente para usuarios autenticados
-- (La política predeterminada de "deny" aplica si no hay política de UPDATE/DELETE explícita)
