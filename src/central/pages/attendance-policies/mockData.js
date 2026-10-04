/**
 * mockData.js — Políticas de Asistencia (MOCK ONLY)
 *
 * ⚠️  DATOS DE DEMOSTRACIÓN — No conectados a producción.
 * Estos datos son exclusivamente para construir la experiencia visual
 * del módulo de Políticas de Asistencia en Central.
 *
 * Cuando el Policy Engine esté listo, reemplazar esta fuente por
 * un repositorio/servicio real sin modificar la estructura de los componentes.
 */

export const MOCK_POLICY_STATES = {
  active:       { id: 'active',       label: 'Activa',         dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' },
  draft:        { id: 'draft',        label: 'Borrador',       dot: 'bg-amber-400',   badge: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  unconfigured: { id: 'unconfigured', label: 'Sin configurar', dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export const MOCK_PERIOD_OPTIONS = [
  { value: 'week',     label: 'Semana' },
  { value: 'fortnight', label: 'Quincena' },
  { value: 'month',    label: 'Mes' },
  { value: 'rolling',  label: 'Días móviles' },
]

export const MOCK_LATE_ACTION_OPTIONS = [
  { value: 'fault', label: 'Generar falta' },
  { value: 'alert', label: 'Generar alerta' },
  { value: 'none',  label: 'Sin acción automática' },
]

export const MOCK_EARLY_EXIT_ACTION_OPTIONS = [
  { value: 'incidence', label: 'Generar incidencia' },
  { value: 'alert',     label: 'Generar alerta' },
  { value: 'log',       label: 'Sólo registrar' },
]

export const MOCK_INCIDENT_ACTION_OPTIONS = [
  { value: 'pending', label: 'Crear incidencia pendiente' },
  { value: 'alert',   label: 'Generar sólo una alerta' },
  { value: 'none',    label: 'Registrar sin crear incidencia' },
]

/** Estructura de política por defecto */
function defaultPolicy(overrides = {}) {
  return {
    toleranciaEntrada: 5,
    toleranciaSalidaAnticipada: 10,
    minimoHorasExtra: 30,
    generarRetardo: true,
    retardoDesde: 6,
    retardoGraveHabilitado: false,
    retardoGraveDesde: 60,
    acumularRetardos: true,
    acumularCantidad: 5,
    acumularPeriodo: 'month',
    acumularDiasMoviles: 30,
    acumularResultado: 'fault',
    detectarSalidaAnticipada: true,
    salidaAnticipadaDesde: 20,
    salidaAnticipadaAccion: 'incidence',
    detectarHorasExtra: true,
    horasExtraMinimo: 30,
    horasExtraRequiereAutorizacion: true,
    accionIncidencia: 'pending',
    vigenteDesde: '2026-09-01',
    vigenteHasta: '',
    ...overrides,
  }
}

export const MOCK_ATTENDANCE_POLICIES = [
  {
    clienteId: 'mock-001',
    empresa: 'Yared Soluciones',
    politica: 'Política General',
    version: 3,
    vigencia: '01 Sep 2026',
    estado: 'active',
    config: defaultPolicy({ toleranciaEntrada: 5, generarRetardo: true }),
    historial: [
      { version: 3, estado: 'active', vigencia: '01 Sep 2026 – presente',   resumen: '5 retardos → falta' },
      { version: 2, estado: 'ended',  vigencia: '01 Jun 2026 – 31 Ago 2026', resumen: 'Tolerancia entrada: 10 min' },
      { version: 1, estado: 'ended',  vigencia: '01 Ene 2026 – 31 May 2026', resumen: 'Configuración inicial' },
    ],
  },
  {
    clienteId: 'mock-002',
    empresa: 'Empresa Industrial del Norte',
    politica: 'Política Industrial',
    version: 1,
    vigencia: '15 Ago 2026',
    estado: 'active',
    config: defaultPolicy({ toleranciaEntrada: 10, toleranciaSalidaAnticipada: 15, minimoHorasExtra: 60 }),
    historial: [
      { version: 1, estado: 'active', vigencia: '15 Ago 2026 – presente', resumen: 'Configuración inicial industrial' },
    ],
  },
  {
    clienteId: 'mock-003',
    empresa: 'Corporativo Logístico SA',
    politica: 'Política Estándar',
    version: 2,
    vigencia: '01 Jul 2026',
    estado: 'draft',
    config: defaultPolicy({ acumularPeriodo: 'week', acumularCantidad: 3 }),
    historial: [
      { version: 2, estado: 'draft', vigencia: 'Borrador',              resumen: 'Ajuste de acumulación' },
      { version: 1, estado: 'ended', vigencia: '01 Jul 2026 – presente', resumen: 'Versión base' },
    ],
  },
  {
    clienteId: 'mock-004',
    empresa: 'Distribuidora Norteña',
    politica: '—',
    version: null,
    vigencia: '—',
    estado: 'unconfigured',
    config: defaultPolicy(),
    historial: [],
  },
  {
    clienteId: 'mock-005',
    empresa: 'Servicios Metropolitanos',
    politica: 'Política Flexible',
    version: 4,
    vigencia: '01 Mar 2026',
    estado: 'active',
    config: defaultPolicy({ horasExtraRequiereAutorizacion: false, toleranciaEntrada: 15 }),
    historial: [
      { version: 4, estado: 'active', vigencia: '01 Mar 2026 – presente',    resumen: 'Horas extra libres' },
      { version: 3, estado: 'ended',  vigencia: '01 Dic 2025 – 28 Feb 2026', resumen: 'Ajuste invernal' },
      { version: 2, estado: 'ended',  vigencia: '01 Sep 2025 – 30 Nov 2025', resumen: 'Periodo prueba' },
      { version: 1, estado: 'ended',  vigencia: '01 Jun 2025 – 31 Ago 2025', resumen: 'Configuración inicial' },
    ],
  },
]
