# Signum Clock — Claude Project Instructions

## Regla principal

NO hagas un barrido completo del repositorio al iniciar una tarea.

Antes de leer código:

1. Lee este archivo.
2. Lee `docs/CURRENT_STATE.md`.
3. Si la tarea involucra base de datos, lee `database/live-schema/CURRENT_DATABASE_CONTRACT.md`.
4. Después abre ÚNICAMENTE los archivos directamente relacionados con la tarea.

No leas carpetas completas salvo que sea estrictamente necesario.

---

# Producto

Signum Clock es una plataforma SaaS multiempresa de tiempo y asistencia.

Usar lenguaje de negocio:

- Empresa
- empresa actual
- multiempresa
- aislamiento por empresa

Evitar en documentación nueva:

- tenant
- multi-tenant

El nombre técnico existente `cliente_id` se conserva como UUID interno de Empresa.

---

# Base de datos

REGLA CRÍTICA:

La base de datos REAL actualmente desplegada es la fuente de verdad.

`supabase/migrations/` es historial y referencia.

NO asumir que una migración histórica representa el schema productivo actual.

NO ejecutar migraciones faltantes automáticamente.

NO modificar migraciones históricas.

Cambios nuevos de BD se trabajan en:

`database/live-schema/`

Contrato conocido:

`database/live-schema/CURRENT_DATABASE_CONTRACT.md`

---

# Biométricos

Fabricante operativo actual:

ZKTeco exclusivamente.

Hikvision es legacy/histórico.

No desarrollar nuevo flujo Hikvision.

No eliminar código/campos legacy sin demostrar primero que ya no tienen consumidores.

---

# Identidad ZKTeco

Fuente de autoridad física:

`device_employee_assignments.biometric_user_id`

Resolución:

`devices.serial_number`
→ `devices.id + devices.cliente_id`
→ `device_employee_assignments(device_id, cliente_id, biometric_user_id)`
→ `employee_id`
→ `empleados.id`

No resolver ATTLOG globalmente mediante:

- `clave_empleado`
- `empleados.pin`
- `device_userid`

`clave_empleado` = identificador administrativo.

`pin` = PIN funcional del colaborador.

`biometric_user_id` = PIN físico asignado en un dispositivo.

`device_userid` = legacy/deprecated candidate; todavía tiene consumidores.

---

# Attendance RAW

Flujo ZKTeco vigente:

`/iclock/cdata`
→ `attendance_logs`
→ `registro_asistencia`

`attendance_logs` es RAW ZKTeco.

Si ZKTeco envía `user_id = 4`, conservar `user_id = 4`.

No reemplazar RAW por `clave_empleado`.

---

# Arquitectura futura de fuentes

Objetivo:

ZKTeco
Web
Mobile App
→ `attendance_source_events`
→ `registro_asistencia`
→ Attendance Engine
→ workday
→ Dashboard

Actualmente:

- ZKTeco = CURRENT
- Web = PLANNED / INACTIVE
- Mobile App = PLANNED / INACTIVE

No activar Web/App sin instrucción explícita.

---

# Jornada nocturna

Regla definitiva:

Turno:

22:00 → 06:00

Entrada:

04 Sep 22:00

Salida:

05 Sep 06:00

Resultado:

una sola jornada.

`workday_date = 04 Sep`

La jornada pertenece al día de inicio.

Para ZKTeco usar `devices.timezone` como autoridad temporal.

---

# Retardos

Retardo detectado automáticamente:

`estado = Pendiente`

para revisión de RH.

El sistema detecta.

RH decide.

---

# Seguridad

Nunca:

- service_role en frontend
- secretos en logs
- JWT en raw_payload
- templates biométricos en logs
- huellas en logs
- fotografías completas en logs
- cruces entre Empresas
- hard delete de historial de asistencia

Preservar RLS y aislamiento por `cliente_id`.

---

# Git

No usar:

- `git reset --hard`
- force push
- eliminación masiva

sin instrucción explícita.

---

# Forma de trabajar

Antes de investigar:

pregunta internamente:

"¿Qué 2–5 archivos necesito realmente para esta tarea?"

Lee esos archivos primero.

NO ejecutes búsquedas globales si ya conoces los archivos responsables.

Si necesitas buscar una referencia:

usa búsqueda textual específica.

Ejemplo:

`device_userid`

NO leas manualmente todo `src/`.

---

# Control de contexto

No releas archivos que ya fueron inspeccionados en esta conversación salvo que:

- hayan cambiado;
- necesites una línea específica;
- exista contradicción.

Al terminar una fase importante:

actualiza `docs/CURRENT_STATE.md` con un resumen compacto.

Ese archivo debe permitir que una conversación nueva continúe sin reconstruir todo el proyecto.

---

# Entrega

En cada tarea reportar:

- archivos realmente leídos;
- archivos modificados;
- tests ejecutados;
- bloqueadores;
- siguiente paso.

Evita investigaciones fuera del alcance solicitado.
