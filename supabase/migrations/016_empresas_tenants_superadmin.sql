-- ================================================================
-- SIGNUM-CLOCK · Migración 016
-- Módulo Master SuperAdmin: Empresas / Tenants
-- ================================================================

-- ================================================================
-- 1. CAMPOS DE GESTIÓN EMPRESARIAL
-- ================================================================

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS rfc VARCHAR(20);

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS plan_suscripcion TEXT DEFAULT 'starter';

-- Migrar valores existentes de plan a plan_suscripcion si existen
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'clientes' AND column_name = 'plan'
    ) THEN
        UPDATE public.clientes
        SET plan_suscripcion = plan
        WHERE (plan_suscripcion IS NULL OR plan_suscripcion = 'starter') AND plan IS NOT NULL;
    END IF;
END $$;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS contacto_nombre TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS contacto_email TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS contacto_telefono VARCHAR(30);

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS direccion TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS ciudad TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS estado TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'México';

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS estatus TEXT DEFAULT 'activo';

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS limite_empleados INTEGER DEFAULT 50;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS limite_dispositivos INTEGER DEFAULT 5;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS notas TEXT;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS logo_url TEXT;


-- ================================================================
-- 2. VALIDACIÓN DEL ESTATUS DE CLIENTES
-- ================================================================

ALTER TABLE public.clientes
DROP CONSTRAINT IF EXISTS clientes_estatus_check;

ALTER TABLE public.clientes
ADD CONSTRAINT clientes_estatus_check
CHECK (
    estatus IN (
        'activo',
        'suspendido',
        'demo',
        'cancelado'
    )
);


-- ================================================================
-- 3. ROLES REALES DEL SISTEMA
-- ================================================================

ALTER TABLE public.usuarios_perfiles
DROP CONSTRAINT IF EXISTS usuarios_perfiles_rol_check;

ALTER TABLE public.usuarios_perfiles
ADD CONSTRAINT usuarios_perfiles_rol_check
CHECK (
    rol IN (
        'superadmin',
        'admin',
        'rh',
        'supervisor',
        'colaborador',
        'operador',
        'auditor'
    )
);

-- ================================================================
-- 4. ASEGURAR QUE SUPERADMIN PUEDA SER GLOBAL
-- ================================================================

ALTER TABLE public.usuarios_perfiles
ALTER COLUMN cliente_id DROP NOT NULL;


-- ================================================================
-- 5. POLÍTICAS RLS PARA SUPERADMIN EN TABLA CLIENTES
-- ================================================================

DROP POLICY IF EXISTS "clientes: SELECT propio" ON public.clientes;
DROP POLICY IF EXISTS "clientes: SELECT all authenticated" ON public.clientes;
DROP POLICY IF EXISTS "clientes: INSERT all authenticated" ON public.clientes;
DROP POLICY IF EXISTS "clientes: UPDATE all authenticated" ON public.clientes;
DROP POLICY IF EXISTS "clientes: DELETE all authenticated" ON public.clientes;

CREATE POLICY "clientes: SELECT all authenticated" ON public.clientes
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "clientes: INSERT all authenticated" ON public.clientes
  FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY "clientes: UPDATE all authenticated" ON public.clientes
  FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "clientes: DELETE all authenticated" ON public.clientes
  FOR DELETE TO authenticated USING (TRUE);


-- ================================================================
-- 6. ÍNDICES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_clientes_estatus
    ON public.clientes (estatus);

CREATE INDEX IF NOT EXISTS idx_clientes_plan_suscripcion
    ON public.clientes (plan_suscripcion);

CREATE INDEX IF NOT EXISTS idx_clientes_rfc
    ON public.clientes (rfc);

CREATE INDEX IF NOT EXISTS idx_usuarios_perfiles_cliente
    ON public.usuarios_perfiles (cliente_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_perfiles_rol
    ON public.usuarios_perfiles (rol);
