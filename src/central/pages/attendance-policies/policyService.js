/**
 * policyService.js — Servicio de Políticas de Asistencia por Empresa
 * Signum Clock Central — SuperAdmin
 *
 * Lee las empresas dadas de alta en Supabase (tabla `clientes`) y gestiona
 * la configuración y versionado de las políticas de asistencia
 * (retardos, tolerancias, faltas acumuladas, horas extras, salidas anticipadas).
 */
import { supabase } from '../../../lib/supabase'

const STORAGE_KEY = 'signum_attendance_policies_v1'

/**
 * Retorna la configuración de política por defecto
 */
export function defaultPolicy(overrides = {}) {
  return {
    nombrePolitica: 'Política General de Asistencia',
    toleranciaEntrada: 5,
    toleranciaSalidaAnticipada: 10,
    minimoHorasExtra: 30,
    generarRetardo: true,
    retardoDesde: 6,
    retardoGraveHabilitado: false,
    retardoGraveDesde: 60,
    acumularRetardos: true,
    acumularCantidad: 3,
    acumularPeriodo: 'month',
    acumularDiasMoviles: 30,
    acumularResultado: 'fault', // 'fault' | 'alert' | 'none'
    detectarSalidaAnticipada: true,
    salidaAnticipadaDesde: 20,
    salidaAnticipadaAccion: 'incidence', // 'incidence' | 'alert' | 'log'
    detectarHorasExtra: true,
    horasExtraMinimo: 30,
    horasExtraRequiereAutorizacion: true,
    accionIncidencia: 'pending', // 'pending' | 'alert' | 'none'
    vigenteDesde: new Date().toISOString().split('T')[0],
    vigenteHasta: '',
    ...overrides,
  }
}

/**
 * Obtiene el mapa completo de políticas guardadas en almacenamiento local
 */
export function getStoredPoliciesMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (err) {
    console.error('[policyService] Error al leer políticas guardadas:', err)
    return {}
  }
}

/**
 * Guarda el mapa completo en almacenamiento local
 */
function setStoredPoliciesMap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch (err) {
    console.error('[policyService] Error al guardar mapa de políticas:', err)
  }
}

/**
 * Genera una cadena legible de vigencia
 */
function formatVigencia(desde, hasta) {
  if (!desde) return '—'
  const parseDate = (d) => {
    try {
      const [y, m, day] = d.split('-')
      const date = new Date(Number(y), Number(m) - 1, Number(day))
      return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch {
      return d
    }
  }

  const desdeStr = parseDate(desde)
  if (!hasta) return `${desdeStr} – presente`
  return `${desdeStr} – ${parseDate(hasta)}`
}

/**
 * Genera un resumen compacto de las reglas de una política para el historial
 */
function generatePolicySummary(config) {
  const parts = []
  parts.push(`Tol. entrada: ${config.toleranciaEntrada} min`)
  if (config.generarRetardo) {
    if (config.acumularRetardos) {
      const accion = config.acumularResultado === 'fault' ? 'falta' : config.acumularResultado === 'alert' ? 'alerta' : 'sin sanción'
      parts.push(`${config.acumularCantidad} retardos → ${accion}`)
    } else {
      parts.push('Retardo activo')
    }
  } else {
    parts.push('Sin retardos')
  }

  if (config.detectarHorasExtra) {
    parts.push(`HE mín ${config.horasExtraMinimo}m${config.horasExtraRequiereAutorizacion ? ' (autorizada)' : ''}`)
  } else {
    parts.push('HE apagadas')
  }

  return parts.join(' · ')
}

/**
 * Consulta las empresas dadas de alta en Supabase y las asocia con su
 * configuración de política de asistencia.
 */
export async function fetchCompaniesWithPolicies() {
  // Consultar empresas reales dadas de alta
  const { data: clients, error } = await supabase
    .from('clientes')
    .select('id, id_empresa, nombre_empresa, rfc, estatus, plan_suscripcion, creado_at')
    .order('nombre_empresa', { ascending: true })

  if (error) {
    console.error('[policyService] Error consultando clientes en Supabase:', error)
    throw error
  }

  const storedMap = getStoredPoliciesMap()

  return (clients || []).map((client) => {
    const stored = storedMap[client.id]

    if (stored) {
      return {
        clienteId: client.id,
        empresa: client.nombre_empresa || 'Empresa sin nombre',
        idEmpresa: client.id_empresa || null,
        rfc: client.rfc || '',
        estatusEmpresa: client.estatus || 'activo',
        politica: stored.politica || stored.config?.nombrePolitica || 'Política General',
        version: stored.version || null,
        vigencia: stored.vigencia || (stored.config?.vigenteDesde ? formatVigencia(stored.config.vigenteDesde, stored.config.vigenteHasta) : '—'),
        estado: stored.estado || 'unconfigured',
        config: { ...defaultPolicy(), ...(stored.config || {}) },
        historial: stored.historial || [],
      }
    }

    // Si aún no tiene política configurada
    return {
      clienteId: client.id,
      empresa: client.nombre_empresa || 'Empresa sin nombre',
      idEmpresa: client.id_empresa || null,
      rfc: client.rfc || '',
      estatusEmpresa: client.estatus || 'activo',
      politica: '—',
      version: null,
      vigencia: '—',
      estado: 'unconfigured',
      config: defaultPolicy(),
      historial: [],
    }
  })
}

/**
 * Guarda o publica la política de asistencia de una empresa dada de alta.
 *
 * @param {string} clienteId - UUID de la empresa en tabla clientes
 * @param {object} baseEntry - Objeto actual de la empresa
 * @param {object} config - Nueva configuración de política
 * @param {boolean} isPublish - true para publicar nueva versión activa, false para guardar borrador
 */
export function saveCompanyPolicy(clienteId, baseEntry, config, isPublish = false) {
  const storedMap = getStoredPoliciesMap()
  const existing = storedMap[clienteId] || baseEntry || {}

  const currentHistorial = Array.isArray(existing.historial) ? [...existing.historial] : []
  const policyTitle = config.nombrePolitica?.trim() || 'Política General'
  const vigenciaStr = formatVigencia(config.vigenteDesde, config.vigenteHasta)
  const summary = generatePolicySummary(config)

  let newVersion = existing.version || null
  let newEstado = 'draft'

  if (isPublish) {
    newVersion = (Number(existing.version) || 0) + 1
    newEstado = 'active'

    // Marcar versiones anteriores activas como finalizadas
    const updatedHistorial = currentHistorial.map((h) => {
      if (h.estado === 'active') {
        return { ...h, estado: 'ended' }
      }
      return h
    })

    // Insertar la nueva versión activa al inicio
    updatedHistorial.unshift({
      version: newVersion,
      estado: 'active',
      vigencia: vigenciaStr,
      resumen: summary,
      fecha: new Date().toISOString(),
    })

    const updatedEntry = {
      ...existing,
      clienteId,
      empresa: baseEntry.empresa,
      idEmpresa: baseEntry.idEmpresa,
      rfc: baseEntry.rfc,
      politica: policyTitle,
      version: newVersion,
      vigencia: config.vigenteDesde || vigenciaStr,
      estado: newEstado,
      config: { ...config },
      historial: updatedHistorial,
      updatedAt: new Date().toISOString(),
    }

    storedMap[clienteId] = updatedEntry
    setStoredPoliciesMap(storedMap)

    // Guardar también copia individual por cliente
    try {
      localStorage.setItem(`signum_attendance_policy_${clienteId}`, JSON.stringify(updatedEntry))
    } catch (e) {
      console.warn('Could not set individual key', e)
    }

    // Notificar a otros módulos o listeners
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('signum:attendance-policy-updated', {
          detail: updatedEntry,
        })
      )
    }

    return updatedEntry
  }

  // Guardar como borrador
  newEstado = 'draft'
  // Si no tenía versión, mantenemos borrador
  const updatedHistorial = [...currentHistorial]
  const draftIdx = updatedHistorial.findIndex((h) => h.estado === 'draft')
  const draftRecord = {
    version: newVersion ? newVersion + 1 : 1,
    estado: 'draft',
    vigencia: 'Borrador en preparación',
    resumen: summary,
    fecha: new Date().toISOString(),
  }

  if (draftIdx >= 0) {
    updatedHistorial[draftIdx] = draftRecord
  } else {
    updatedHistorial.unshift(draftRecord)
  }

  const updatedEntry = {
    ...existing,
    clienteId,
    empresa: baseEntry.empresa,
    idEmpresa: baseEntry.idEmpresa,
    rfc: baseEntry.rfc,
    politica: policyTitle,
    version: newVersion,
    vigencia: existing.vigencia || 'Borrador',
    estado: newEstado,
    config: { ...config },
    historial: updatedHistorial,
    updatedAt: new Date().toISOString(),
  }

  storedMap[clienteId] = updatedEntry
  setStoredPoliciesMap(storedMap)

  try {
    localStorage.setItem(`signum_attendance_policy_${clienteId}`, JSON.stringify(updatedEntry))
  } catch (e) {
    console.warn('Could not set individual key', e)
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('signum:attendance-policy-updated', {
        detail: updatedEntry,
      })
    )
  }

  return updatedEntry
}
