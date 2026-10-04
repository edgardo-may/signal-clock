import { getLocalComponents, isValidTimezone, localToUtcIso } from '../../../domain/attendance/timezoneUtils.ts'

export { getLocalComponents }

// Keep this in step with the established device UI. It represents ADMS activity,
// not whether the device is merely enabled in configuration.
export const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000

const DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

function shiftLocalDate(localDate, days) {
  const date = new Date(`${localDate}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getTenantDayContext(timezone) {
  const safeTimezone = isValidTimezone(timezone) ? timezone : 'America/Mexico_City'
  const local = getLocalComponents(new Date(), safeTimezone)
  const weekdayDate = new Date(`${local.localDate}T12:00:00.000Z`)
  const dayIndex = (weekdayDate.getUTCDay() + 6) % 7
  const weekStartLocalDate = shiftLocalDate(local.localDate, -dayIndex)
  const weekEndLocalDate = shiftLocalDate(weekStartLocalDate, 7)

  return {
    timezone: safeTimezone,
    localDate: local.localDate,
    nextLocalDate: shiftLocalDate(local.localDate, 1),
    dayKey: DAY_KEYS[weekdayDate.getUTCDay()],
    dayIndex,
    startUtc: localToUtcIso(local.localDate, '00:00:00', safeTimezone),
    endUtc: localToUtcIso(shiftLocalDate(local.localDate, 1), '00:00:00', safeTimezone),
    weekStartLocalDate,
    weekEndLocalDate,
    weekStartUtc: localToUtcIso(weekStartLocalDate, '00:00:00', safeTimezone),
    weekEndUtc: localToUtcIso(weekEndLocalDate, '00:00:00', safeTimezone),
  }
}

export function getDeviceOperationalStatus(device, now = Date.now()) {
  if (!device.is_active) return 'disabled'
  if (!device.last_activity) return 'pending'

  const lastActivity = new Date(device.last_activity).getTime()
  if (Number.isNaN(lastActivity) || now - lastActivity >= DEVICE_ONLINE_WINDOW_MS) return 'offline'

  return 'online'
}

export function getScheduledEmployeeIds(assignments, localDate, dayKey) {
  const assignmentsByEmployee = new Map()

  assignments
    .filter((assignment) => !assignment.fecha_fin || assignment.fecha_fin >= localDate)
    .forEach((assignment) => {
      const current = assignmentsByEmployee.get(assignment.empleado_id) ?? []
      current.push(assignment)
      assignmentsByEmployee.set(assignment.empleado_id, current)
    })

  const scheduledIds = new Set()
  let ambiguousAssignments = 0

  assignmentsByEmployee.forEach((employeeAssignments, employeeId) => {
    // The Attendance Engine treats more than one active assignment as ambiguous.
    // Mirror that safety here rather than selecting an arbitrary shift.
    if (employeeAssignments.length !== 1) {
      ambiguousAssignments += 1
      return
    }

    const schedule = employeeAssignments[0].horarios
    const dayConfig = schedule?.dias_config?.[dayKey]
    if (schedule?.activo && dayConfig?.activo && dayConfig?.entrada) {
      scheduledIds.add(employeeId)
    }
  })

  return { scheduledIds, ambiguousAssignments }
}

function buildDeviceHealth(devices, assignments) {
  const assignmentSummary = assignments.reduce((summary, assignment) => {
    const current = summary.get(assignment.device_id) ?? { pending: 0, error: 0 }
    if (assignment.sync_status === 'PENDING' || assignment.sync_status === 'SYNCING') current.pending += 1
    if (assignment.sync_status === 'ERROR') current.error += 1
    summary.set(assignment.device_id, current)
    return summary
  }, new Map())

  const deviceHealth = devices.map((device) => ({
    ...device,
    operationalStatus: getDeviceOperationalStatus(device),
    sync: assignmentSummary.get(device.id) ?? { pending: 0, error: 0 },
  }))

  const enabledDevices = deviceHealth.filter((device) => device.is_active)
  return {
    devices: deviceHealth,
    active: enabledDevices.length,
    online: enabledDevices.filter((device) => device.operationalStatus === 'online').length,
    offline: enabledDevices.filter((device) => device.operationalStatus === 'offline').length,
    pendingConnection: enabledDevices.filter((device) => device.operationalStatus === 'pending').length,
    disabled: deviceHealth.filter((device) => !device.is_active).length,
    pendingSync: deviceHealth.reduce((total, device) => total + device.sync.pending, 0),
    syncErrors: deviceHealth.reduce((total, device) => total + device.sync.error, 0),
  }
}

// Resultado por widget: null = no disponible, valor = dato confirmado.
// Cada widget falla de forma independiente sin derribar los demás.
export const WIDGET_UNAVAILABLE = null

async function safeQuery(queryFn) {
  try {
    const result = await queryFn()
    if (result.error) {
      console.warn('[Dashboard] Query parcial con error:', result.error.message)
      return { data: null, count: null, error: result.error }
    }
    return result
  } catch (err) {
    console.warn('[Dashboard] Query parcial falló:', err)
    return { data: null, count: null, error: err }
  }
}

export async function loadDashboardOperations(supabase, clienteId) {
  // 1. Timezone del tenant (America/Cancun por defecto, coincidente con la sede del cliente)
  const tenantTimezone = 'America/Cancun'

  const day = getTenantDayContext(tenantTimezone)

  // 2. Todas las queries en paralelo con safeQuery — cada una falla de forma
  //    independiente. Una query con error no bloquea las demás.
  const [
    employeesResult,
    schedulesResult,
    devicesResult,
    incidentsResult,
    todayMarksResult,
    recentMarksResult,
    weeklyMarksResult,
  ] = await Promise.all([
    safeQuery(() =>
      supabase.from('empleados').select('id, activo').eq('cliente_id', clienteId)
    ),
    safeQuery(() =>
      supabase
        .from('empleados_horarios')
        .select('empleado_id, fecha_fin, horarios(id, activo, dias_config)')
        .eq('cliente_id', clienteId)
        .eq('activo', true)
        .lte('fecha_inicio', day.localDate)
    ),
    safeQuery(() =>
      supabase
        .from('devices')
        .select('id, name, location, serial_number, is_active, last_activity')
        .eq('cliente_id', clienteId)
        .order('name', { ascending: true })
    ),
    safeQuery(() =>
      supabase
        .from('incidencias')
        .select('*', { count: 'exact', head: true })
        .eq('cliente_id', clienteId)
        .eq('estado', 'Pendiente')
    ),
    safeQuery(() =>
      supabase
        .from('registro_asistencia')
        .select('*', { count: 'exact', head: true })
        .eq('cliente_id', clienteId)
        .gte('verificado_at', day.startUtc)
        .lt('verificado_at', day.endUtc)
    ),
    // Join con empleados y devices — si falla (FK, RLS, nombre de relación),
    // se degrada a lista vacía en lugar de derribar todo.
    safeQuery(() =>
      supabase
        .from('registro_asistencia')
        .select(`
          id, verificado_at, tipo_verificacion, metodo, raw_payload,
          empleados(nombre, apellido, avatar_url),
          devices(name, location)
        `)
        .eq('cliente_id', clienteId)
        .order('verificado_at', { ascending: false })
        .limit(50)
    ),
    safeQuery(() =>
      supabase
        .from('registro_asistencia')
        .select('verificado_at')
        .eq('cliente_id', clienteId)
        .gte('verificado_at', day.weekStartUtc)
        .lt('verificado_at', day.weekEndUtc)
    ),
  ])

  // 3. Device assignments — solo si la query de devices funcionó.
  const devices = devicesResult.data ?? []
  let assignments = []
  if (devices.length > 0) {
    const assignmentsResult = await safeQuery(() =>
      supabase
        .from('device_employee_assignments')
        .select('device_id, sync_status')
        .eq('cliente_id', clienteId)
        .in('device_id', devices.map((device) => device.id))
    )
    assignments = assignmentsResult.data ?? []
  }

  // 4. Derivar métricas — cada una tiene su propio estado de disponibilidad.
  const employees = employeesResult.data ?? []
  const activeEmployeeIds = new Set(
    employees.filter((e) => e.activo).map((e) => e.id)
  )

  const { scheduledIds, ambiguousAssignments } = getScheduledEmployeeIds(
    schedulesResult.data ?? [],
    day.localDate,
    day.dayKey,
  )
  const scheduled = [...scheduledIds].filter((id) => activeEmployeeIds.has(id)).length

  const deviceHealth = buildDeviceHealth(devices, assignments)

  // recentMarks: si el join con empleados/devices falló, intentar sin join
  // para conservar al menos las fechas y tipos.
  let recentMarks = recentMarksResult.data ?? []
  if (recentMarksResult.error && recentMarksResult.error.code !== 'PGRST200') {
    // PGRST200 = foreign key / relation not found → degradar silenciosamente
    recentMarks = []
  }

  return {
    day,
    // errors expuestos por widget para que el UI los muestre individualmente
    widgetErrors: {
      employees: employeesResult.error ? employeesResult.error.message : null,
      schedules: schedulesResult.error ? schedulesResult.error.message : null,
      devices: devicesResult.error ? devicesResult.error.message : null,
      incidents: incidentsResult.error ? incidentsResult.error.message : null,
      todayMarks: todayMarksResult.error ? todayMarksResult.error.message : null,
      recentMarks: recentMarksResult.error ? recentMarksResult.error.message : null,
      weeklyMarks: weeklyMarksResult.error ? weeklyMarksResult.error.message : null,
    },
    stats: {
      // null = no disponible; número = dato confirmado
      activeEmployees: employeesResult.error ? WIDGET_UNAVAILABLE : activeEmployeeIds.size,
      inactiveEmployees: employeesResult.error ? WIDGET_UNAVAILABLE : employees.filter((e) => !e.activo).length,
      scheduled: schedulesResult.error ? WIDGET_UNAVAILABLE : scheduled,
      scheduledAmbiguities: schedulesResult.error ? 0 : ambiguousAssignments,
      pendingIncidents: incidentsResult.error ? WIDGET_UNAVAILABLE : (incidentsResult.count ?? 0),
      todayMarks: todayMarksResult.error ? WIDGET_UNAVAILABLE : (todayMarksResult.count ?? 0),
      deviceHealth,
    },
    recentMarks,
    weeklyMarks: weeklyMarksResult.data ?? [],
  }
}
