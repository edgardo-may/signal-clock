-- ================================================================
--  SIGNUM-CLOCK · Migración 002 · Perfiles de Usuario Multi-Tenant
--  Plataforma: Supabase (PostgreSQL 15+)
--  Seguridad:  RLS estricta por JWT cliente_id · Trigger auto-provisioning
-- ================================================================

-- ──────────────────────────────────────────────────────────────
-- 1. TABLA: usuarios_perfiles
--    Vinculada a auth.users mediante FK + CASCADE DELETE.
--    Cada fila pertenece EXACTAMENTE a un cliente (tenant).
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usuarios_perfiles (
  id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_id       UUID        NOT NULL    REFERENCES public.clientes(id) ON DELETE CASCADE,
  nombre           TEXT        NOT NULL    DEFAULT '',
  rol              TEXT        NOT NULL    DEFAULT 'operador'
                                  CHECK (rol IN ('admin', 'operador', 'auditor')),
  estatus_cuenta   TEXT        NOT NULL    DEFAULT 'activo'
                                  CHECK (estatus_cuenta IN ('activo', 'suspendido', 'pendiente')),
  ultimo_acceso    TIMESTAMPTZ,
  creado_at        TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  actualizado_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Índices de rendimiento y aislamiento por tenant
CREATE INDEX IF NOT EXISTS idx_usuarios_perfiles_cliente
  ON public.usuarios_perfiles (cliente_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_perfiles_cliente_rol
  ON public.usuarios_perfiles (cliente_id, rol);

CREATE INDEX IF NOT EXISTS idx_usuarios_perfiles_cliente_estatus
  ON public.usuarios_perfiles (cliente_id, estatus_cuenta);

-- Trigger updated_at (reutiliza función de migración 001)
CREATE OR REPLACE TRIGGER trg_usuarios_perfiles_updated_at
  BEFORE UPDATE ON public.usuarios_perfiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ──────────────────────────────────────────────────────────────
-- 2. FUNCIÓN: auto-provisioning de perfil al registrar usuario
--
--    Se dispara después de cada INSERT en auth.users.
--    Lee cliente_id y nombre desde raw_user_meta_data.
--
--    Metadatos esperados al crear el usuario:
--      { "cliente_id": "<uuid>", "nombre": "Juan Pérez", "rol": "operador" }
--
--    Si cliente_id no está presente el trigger hace NOOP para
--    no insertar registros huérfanos.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_crear_perfil_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id  UUID;
  v_nombre      TEXT;
  v_rol         TEXT;
BEGIN
  v_cliente_id := (NEW.raw_user_meta_data ->> 'cliente_id')::UUID;
  v_nombre     := COALESCE(NEW.raw_user_meta_data ->> 'nombre', split_part(NEW.email, '@', 1));
  v_rol        := COALESCE(NEW.raw_user_meta_data ->> 'rol', 'operador');

  -- Sanitizar rol contra valores no permitidos
  IF v_rol NOT IN ('admin', 'operador', 'auditor') THEN
    v_rol := 'operador';
  END IF;

  -- Abortar sin perfil si no hay cliente asociado
  IF v_cliente_id IS NULL THEN
    RAISE WARNING '[Signum-Clock] Usuario % sin cliente_id en metadatos. Perfil NO creado.', NEW.id;
    RETURN NEW;
  END IF;

  -- Verificar que el cliente exista para mantener integridad referencial
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cliente_id) THEN
    RAISE WARNING '[Signum-Clock] cliente_id % no existe. Perfil NO creado.', v_cliente_id;
    RETURN NEW;
  END IF;

  -- Inserción idempotente
  INSERT INTO public.usuarios_perfiles (id, cliente_id, nombre, rol, estatus_cuenta)
  VALUES (NEW.id, v_cliente_id, v_nombre, v_rol, 'activo')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El trigger NUNCA debe bloquear el registro de Auth
  RAISE WARNING '[Signum-Clock] Error al crear perfil para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Asociar trigger a auth.users
DROP TRIGGER IF EXISTS trg_auto_crear_perfil_usuario ON auth.users;
CREATE TRIGGER trg_auto_crear_perfil_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_crear_perfil_usuario();


-- ──────────────────────────────────────────────────────────────
-- 3. FUNCIÓN RPC: registrar ultimo_acceso
--    El frontend la llama tras un login exitoso.
--    SECURITY DEFINER: actualiza sin exponer UPDATE directo.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_ultimo_acceso()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.usuarios_perfiles
     SET ultimo_acceso  = NOW(),
         actualizado_at = NOW()
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_ultimo_acceso() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_registrar_ultimo_acceso() TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 4. FUNCIÓN RLS HELPER: auth_cuenta_activa()
--
--    Retorna TRUE solo si el usuario autenticado tiene
--    estatus_cuenta = 'activo' en su tenant.
--    Cuentas suspendidas son rechazadas a nivel de DB
--    incluso si presentan un JWT válido.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_cuenta_activa()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios_perfiles
     WHERE id             = auth.uid()
       AND cliente_id     = public.auth_cliente_id()
       AND estatus_cuenta = 'activo'
  );
$$;


-- ──────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY: usuarios_perfiles
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.usuarios_perfiles ENABLE ROW LEVEL SECURITY;

-- Un usuario ve TODOS los perfiles de su tenant (necesario para dashboards admin)
CREATE POLICY "perfiles: SELECT tenant activo"
  ON public.usuarios_perfiles
  FOR SELECT TO authenticated
  USING (
    cliente_id = public.auth_cliente_id()
    AND public.auth_cuenta_activa()
  );

-- Un usuario SIEMPRE puede leer su propio perfil
-- (requerido para validar estatus al iniciar sesión)
CREATE POLICY "perfiles: SELECT propio"
  ON public.usuarios_perfiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Solo service_role inserta (el trigger actúa en su nombre)
CREATE POLICY "perfiles: INSERT service_role"
  ON public.usuarios_perfiles
  FOR INSERT TO service_role
  WITH CHECK (TRUE);

-- Solo admins del mismo tenant pueden actualizar perfiles
-- Protección anti-escalación: cliente_id no puede cambiar
CREATE POLICY "perfiles: UPDATE admin"
  ON public.usuarios_perfiles
  FOR UPDATE TO authenticated
  USING (
    cliente_id = public.auth_cliente_id()
    AND public.auth_cuenta_activa()
    AND EXISTS (
      SELECT 1 FROM public.usuarios_perfiles adm
       WHERE adm.id         = auth.uid()
         AND adm.cliente_id = public.auth_cliente_id()
         AND adm.rol        = 'admin'
    )
  )
  WITH CHECK (cliente_id = public.auth_cliente_id());

-- DELETE: solo service_role (CASCADE de auth.users cubre el resto)
CREATE POLICY "perfiles: DELETE service_role"
  ON public.usuarios_perfiles
  FOR DELETE TO service_role
  USING (TRUE);


-- ──────────────────────────────────────────────────────────────
-- 6. REFUERZO DE POLÍTICAS EN TABLAS EXISTENTES
--    Agrega auth_cuenta_activa() a todas las tablas operativas.
--    Bloquea acceso a cuentas suspendidas a nivel de base de datos.
-- ──────────────────────────────────────────────────────────────

-- ── empleados ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "empleados: SELECT" ON public.empleados;
CREATE POLICY "empleados: SELECT"
  ON public.empleados FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

DROP POLICY IF EXISTS "empleados: INSERT" ON public.empleados;
CREATE POLICY "empleados: INSERT"
  ON public.empleados FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

DROP POLICY IF EXISTS "empleados: UPDATE" ON public.empleados;
CREATE POLICY "empleados: UPDATE"
  ON public.empleados FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa())
  WITH CHECK (cliente_id = public.auth_cliente_id());

DROP POLICY IF EXISTS "empleados: DELETE" ON public.empleados;
CREATE POLICY "empleados: DELETE"
  ON public.empleados FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

-- ── dispositivos ───────────────────────────────────────────────
DROP POLICY IF EXISTS "dispositivos: SELECT" ON public.dispositivos;
CREATE POLICY "dispositivos: SELECT"
  ON public.dispositivos FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

DROP POLICY IF EXISTS "dispositivos: INSERT" ON public.dispositivos;
CREATE POLICY "dispositivos: INSERT"
  ON public.dispositivos FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

DROP POLICY IF EXISTS "dispositivos: UPDATE" ON public.dispositivos;
CREATE POLICY "dispositivos: UPDATE"
  ON public.dispositivos FOR UPDATE TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa())
  WITH CHECK (cliente_id = public.auth_cliente_id());

DROP POLICY IF EXISTS "dispositivos: DELETE" ON public.dispositivos;
CREATE POLICY "dispositivos: DELETE"
  ON public.dispositivos FOR DELETE TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

-- ── asistencias ────────────────────────────────────────────────
DROP POLICY IF EXISTS "asistencias: SELECT" ON public.asistencias;
CREATE POLICY "asistencias: SELECT"
  ON public.asistencias FOR SELECT TO authenticated
  USING (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());

DROP POLICY IF EXISTS "asistencias: INSERT" ON public.asistencias;
CREATE POLICY "asistencias: INSERT"
  ON public.asistencias FOR INSERT TO authenticated
  WITH CHECK (cliente_id = public.auth_cliente_id() AND public.auth_cuenta_activa());


-- ──────────────────────────────────────────────────────────────
-- 7. GRANTS FINALES
-- ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, UPDATE                         ON public.usuarios_perfiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE         ON public.usuarios_perfiles TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_auto_crear_perfil_usuario()  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_registrar_ultimo_acceso()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_cuenta_activa()            TO authenticated, service_role;


-- ──────────────────────────────────────────────────────────────
-- 8. COMENTARIOS
-- ──────────────────────────────────────────────────────────────
COMMENT ON TABLE public.usuarios_perfiles IS
  'Perfiles de usuario vinculados 1:1 a auth.users. Aislados por tenant. Auto-provisionados via trigger AFTER INSERT ON auth.users.';
COMMENT ON COLUMN public.usuarios_perfiles.id IS
  'UUID idéntico al de auth.users. FK ON DELETE CASCADE.';
COMMENT ON COLUMN public.usuarios_perfiles.cliente_id IS
  'Tenant propietario. Protegido contra mutación por usuarios authenticated.';
COMMENT ON COLUMN public.usuarios_perfiles.estatus_cuenta IS
  'activo = acceso normal · suspendido = bloqueado por admin (rechazado en RLS) · pendiente = sin confirmar.';
COMMENT ON FUNCTION public.fn_auto_crear_perfil_usuario() IS
  'Trigger AFTER INSERT ON auth.users. Lee cliente_id/nombre/rol de raw_user_meta_data. SECURITY DEFINER para acceder a auth schema.';
COMMENT ON FUNCTION public.auth_cuenta_activa() IS
  'Helper RLS. Retorna TRUE solo si el JWT pertenece a un usuario con estatus_cuenta=activo en su tenant. Bloquea suspendidos a nivel DB.';
