-- Permite configurar por separado Horarios, Agenda de turnos y Días festivos.
-- La migración 032 ya fue aplicada; por eso se amplía su constraint aquí.

ALTER TABLE public.user_module_permissions
  DROP CONSTRAINT IF EXISTS user_module_permissions_module_key_check;

ALTER TABLE public.user_module_permissions
  ADD CONSTRAINT user_module_permissions_module_key_check
  CHECK (module_key IN (
    'dashboard',
    'employees',
    'schedules',
    'schedule_agenda',
    'holidays',
    'attendance',
    'attendance_manage',
    'reports',
    'biometrics',
    'users',
    'synchronization',
    'permissions'
  ));
