-- ================================================================
-- SIGNUM-CLOCK · Migración 043
-- Audit Logging RLS Fix
-- Corrige la política para evitar que cualquier usuario lea los logs
-- ================================================================

-- Eliminar la política permisiva previa
DROP POLICY IF EXISTS "audit_logs: SELECT tenant" ON public.audit_logs;

-- Nueva política: solo el rol 'admin' puede leer los logs de su propio tenant
CREATE POLICY "audit_logs: SELECT admin tenant"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    cliente_id = public.auth_current_cliente_id() 
    AND public.auth_cuenta_activa()
    AND public.auth_current_role() = 'admin'
  );

-- Revocar INSERT desde frontend (si existía)
DROP POLICY IF EXISTS "audit_logs: INSERT tenant" ON public.audit_logs;
