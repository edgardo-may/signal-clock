-- ============================================================================
-- Catálogo escalable de módulos y propagación en tiempo real de permisos.
-- Nuevos módulos se registran desde Central; ya no requieren modificar el
-- CHECK de user_module_permissions para poder ser asignados.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.module_catalog (
  module_key TEXT PRIMARY KEY CHECK (module_key ~ '^[a-z][a-z0-9_]*$'),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  module_group TEXT NOT NULL DEFAULT 'Otros',
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.module_catalog (module_key, label, description, module_group, sort_order)
VALUES
  ('dashboard', 'Dashboard', 'Indicadores generales de asistencia.', 'Consulta', 10),
  ('employees', 'Colaboradores', 'Directorio y administración de personal.', 'Operación', 20),
  ('schedules', 'Horarios y turnos', 'Creación y edición de horarios.', 'Operación', 30),
  ('schedule_agenda', 'Agenda de turnos', 'Asignación de horarios a colaboradores.', 'Operación', 40),
  ('holidays', 'Días festivos', 'Configuración de asuetos y días no laborables.', 'Operación', 50),
  ('attendance', 'Asistencia', 'Consulta de checadas y asistencias.', 'Consulta', 60),
  ('attendance_manage', 'Operación de asistencia', 'Captura manual, incidencias y kiosco.', 'Operación', 70),
  ('reports', 'Reportes', 'Reportes, matriz, retardos e historial.', 'Consulta', 80),
  ('biometrics', 'Biométricos', 'Dispositivos, asignaciones y enrolamiento.', 'Dispositivos', 90),
  ('synchronization', 'Sincronización', 'Importación y sincronización de colaboradores.', 'Administración', 100),
  ('users', 'Usuarios', 'Administración de usuarios de la empresa.', 'Administración', 110),
  ('permissions', 'Permisos de módulos', 'Asignación de accesos por usuario.', 'Administración', 120)
ON CONFLICT (module_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    module_group = EXCLUDED.module_group,
    sort_order = EXCLUDED.sort_order,
    actualizado_at = NOW();

DROP TRIGGER IF EXISTS trg_module_catalog_updated_at ON public.module_catalog;
CREATE TRIGGER trg_module_catalog_updated_at
  BEFORE UPDATE ON public.module_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 033 dejó una lista cerrada. A partir de ahora la clave debe existir en el
-- catálogo, lo que permite agregar módulos sin nuevas migraciones de permisos.
ALTER TABLE public.user_module_permissions
  DROP CONSTRAINT IF EXISTS user_module_permissions_module_key_check;

ALTER TABLE public.user_module_permissions
  DROP CONSTRAINT IF EXISTS user_module_permissions_module_key_fkey;

ALTER TABLE public.user_module_permissions
  ADD CONSTRAINT user_module_permissions_module_key_fkey
  FOREIGN KEY (module_key)
  REFERENCES public.module_catalog(module_key)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

ALTER TABLE public.module_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_catalog: SELECT activos"
  ON public.module_catalog FOR SELECT TO authenticated
  USING (active OR public.auth_is_superadmin());

CREATE POLICY "module_catalog: INSERT superadmin"
  ON public.module_catalog FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_superadmin());

CREATE POLICY "module_catalog: UPDATE superadmin"
  ON public.module_catalog FOR UPDATE TO authenticated
  USING (public.auth_is_superadmin())
  WITH CHECK (public.auth_is_superadmin());

CREATE POLICY "module_catalog: DELETE superadmin"
  ON public.module_catalog FOR DELETE TO authenticated
  USING (public.auth_is_superadmin());

GRANT SELECT ON public.module_catalog TO authenticated;
GRANT ALL ON public.module_catalog TO service_role;

-- Realtime permite que un usuario afectado por un cambio en Central reciba el
-- nuevo permiso de inmediato. Los bloques evitan errores si ya está publicada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'user_module_permissions'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_module_permissions';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'module_catalog'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.module_catalog';
    END IF;
  END IF;
END
$$;
