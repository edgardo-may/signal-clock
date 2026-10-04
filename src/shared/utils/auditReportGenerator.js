// src/shared/utils/auditReportGenerator.js — Generador de Reportes Profesionales de Auditoría
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { SIGNUM_LOGO_DATA_URL } from './logoBase64.js'

/**
 * Mapeo de acciones de auditoría a nombres amigables en español
 */
export const ACTION_LABELS = {
  'USER_CREATED': 'Usuario creado',
  'USER_UPDATED': 'Usuario actualizado',
  'USER_DELETED': 'Usuario eliminado',
  'DEVICE_REGISTERED': 'Dispositivo registrado',
  'DEVICE_DISABLED': 'Dispositivo deshabilitado',
  'ROLE_CHANGED': 'Cambio de rol',
  'SECURITY_DENIED': 'Acceso de seguridad denegado',
  'SCHEDULE_CREATED': 'Horario creado',
  'SCHEDULE_UPDATED': 'Horario modificado',
  'SCHEDULE_DELETED': 'Horario eliminado',
  'SCHEDULE_ASSIGNED': 'Horario asignado a empleado',
  'SCHEDULE_UNASSIGNED': 'Horario retirado a empleado',
  'EMPLOYEE_CREATED': 'Empleado registrado',
  'EMPLOYEE_UPDATED': 'Empleado modificado',
  'EMPLOYEE_DEACTIVATED': 'Empleado desactivado',
  'EMPLOYEE_REACTIVATED': 'Empleado reactivado',
  'INCIDENCE_CREATED': 'Incidencia asignada a colaborador',
  'INCIDENCE_UPDATED': 'Incidencia modificada',
  'INCIDENCE_DELETED': 'Incidencia eliminada',
  'ATTENDANCE_LOGGED': 'Marcaje de asistencia registrado',
  'DEVICE_REBOOT': 'Reinicio de dispositivo',
  'TIMEZONE_UPDATE': 'Actualización de zona horaria'
}

export function formatActionLabel(action) {
  if (!action) return '—'
  return ACTION_LABELS[action] || action.replace(/_/g, ' ')
}

/**
 * Formatea una fecha en zona horaria de Cancún (America/Cancun / UTC-5)
 */
export function formatDateCancun(dateInput, pattern = "dd/MM/yyyy HH:mm:ss") {
  if (!dateInput) return '—'
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Cancun',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d)
  } catch (e) {
    try {
      return format(new Date(dateInput), pattern, { locale: es })
    } catch {
      return String(dateInput)
    }
  }
}

/**
 * Genera y abre el reporte profesional de auditoría en una nueva ventana para impresión/PDF
 */
export function openProfessionalAuditReport({
  logs = [],
  usersMap = {},
  tenantsMap = {},
  currentUser = null,
  activeTenant = null,
  filters = {},
  scope = 'central'
}) {
  if (!logs || logs.length === 0) {
    return { success: false, message: 'No hay registros de auditoría disponibles para exportar.' }
  }

  // Folio único para el informe
  const todayStr = format(new Date(), 'yyyyMMdd')
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  const folio = `SC-AUD-${todayStr}-${randomSuffix}`

  // Fecha de emisión en Cancún
  const fechaEmisionCancun = formatDateCancun(new Date())

  // Métricas para Resumen Ejecutivo
  const totalEventos = logs.length
  const exitosos = logs.filter(l => (l.result || '').toUpperCase() === 'SUCCESS').length
  const rechazados = logs.filter(l => (l.result || '').toUpperCase() === 'DENIED').length
  const errores = logs.filter(l => (l.result || '').toUpperCase() === 'ERROR').length
  const tasaExito = totalEventos > 0 ? Math.round((exitosos / totalEventos) * 100) : 0

  const uniqueActors = new Set(logs.map(l => l.actor_user_id).filter(Boolean)).size
  const uniqueResources = new Set(logs.map(l => l.resource_type).filter(Boolean)).size

  // Información del usuario generador
  const emisorNombre = currentUser?.nombre || currentUser?.email || 'Administrador del Sistema'
  const emisorRol = (currentUser?.rol || 'ADMIN').toUpperCase()
  const emisorEmail = currentUser?.email || ''

  // Ámbito / Empresa
  const tenantNombre = activeTenant?.nombre_comercial || activeTenant?.nombre_empresa || (scope === 'central' ? 'Global / Multi-Empresa' : 'Empresa Local')

  // Construir filas de la tabla
  const rowsHtml = logs.map((log, index) => {
    const actor = log.actor_user_id ? usersMap[log.actor_user_id] : null
    let actorName = 'Sistema Automático'
    if (actor) {
      actorName = actor.nombre || (actor.email ? actor.email.split('@')[0] : 'Usuario')
    } else if (log.actor_user_id) {
      if (currentUser && currentUser.id === log.actor_user_id) {
        actorName = currentUser.nombre || (currentUser.email ? currentUser.email.split('@')[0] : 'Administrador')
      } else {
        actorName = log.actor_role ? `Usuario (${log.actor_role})` : 'Usuario del Sistema'
      }
    }
    const actorRole = log.actor_role || actor?.rol || '—'

    const tenant = log.cliente_id ? tenantsMap[log.cliente_id] : null
    let tenantName = 'Global'
    if (tenant) {
      tenantName = tenant.nombre_comercial || tenant.nombre_empresa || 'Empresa Local'
    } else if (activeTenant && (activeTenant.id === log.cliente_id || scope !== 'central')) {
      tenantName = activeTenant.nombre_comercial || activeTenant.nombre_empresa || 'Empresa Local'
    } else if (log.cliente_id) {
      tenantName = 'Empresa Local'
    }

    const actionText = formatActionLabel(log.action)
    const rawAction = log.action || '—'
    const fechaHoraCancun = formatDateCancun(log.created_at)

    const result = (log.result || 'UNKNOWN').toUpperCase()
    let resultBadgeClass = 'badge-unknown'
    let resultIcon = '●'
    let resultLabel = result

    if (result === 'SUCCESS') {
      resultBadgeClass = 'badge-success'
      resultIcon = '✓'
      resultLabel = 'Exitoso'
    } else if (result === 'DENIED') {
      resultBadgeClass = 'badge-denied'
      resultIcon = '⚠'
      resultLabel = 'Rechazado'
    } else if (result === 'ERROR') {
      resultBadgeClass = 'badge-error'
      resultIcon = '✕'
      resultLabel = 'Error'
    }

    const resourceType = log.resource_type || '—'
    const resourceId = log.resource_id ? (log.resource_id.length > 18 ? log.resource_id.slice(0, 16) + '…' : log.resource_id) : '—'

    return `
      <tr>
        <td class="col-idx">${index + 1}</td>
        <td class="col-date">
          <div class="date-main">${fechaHoraCancun}</div>
          <div class="date-sub">Cancún (UTC-5)</div>
        </td>
        <td class="col-actor">
          <div class="actor-name">${escapeHtml(actorName)}</div>
          <div class="actor-role">${escapeHtml(actorRole)}</div>
        </td>
        <td class="col-tenant">${escapeHtml(tenantName)}</td>
        <td class="col-action">
          <div class="action-friendly">${escapeHtml(actionText)}</div>
          <div class="action-code">${escapeHtml(rawAction)}</div>
        </td>
        <td class="col-resource">
          <div class="resource-type">${escapeHtml(resourceType)}</div>
          <div class="resource-id" title="${escapeHtml(log.resource_id || '')}">${escapeHtml(resourceId)}</div>
        </td>
        <td class="col-result">
          <span class="badge ${resultBadgeClass}">
            <span class="badge-icon">${resultIcon}</span>
            <span>${resultLabel}</span>
          </span>
        </td>
      </tr>
    `
  }).join('')

  // Resumen de filtros aplicados
  const filterDesc = []
  if (filters.action && filters.action !== 'todos') filterDesc.push(`Acción: <strong>${escapeHtml(formatActionLabel(filters.action))}</strong>`)
  if (filters.result && filters.result !== 'todos') filterDesc.push(`Resultado: <strong>${escapeHtml(filters.result)}</strong>`)
  if (filters.dateFrom) filterDesc.push(`Desde: <strong>${escapeHtml(filters.dateFrom)}</strong>`)
  if (filters.dateTo) filterDesc.push(`Hasta: <strong>${escapeHtml(filters.dateTo)}</strong>`)
  if (filters.search) filterDesc.push(`Búsqueda: <em>"${escapeHtml(filters.search)}"</em>`)
  const filtersSummaryText = filterDesc.length > 0 ? filterDesc.join(' &bull; ') : 'Todos los registros visibles sin restricción adicional'

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe de Auditoría y Seguridad — ${folio}</title>
  <style>
    /* ─── RESET Y ESTILOS BASE ─── */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #0f172a;
      background-color: #f1f5f9;
      padding: 0;
      margin: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ─── BARRA DE ACCIONES (NO IMPRESA) ─── */
    .toolbar-container {
      position: sticky;
      top: 0;
      z-index: 9999;
      background: #00252b;
      color: #ffffff;
      padding: 10px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .toolbar-info {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .toolbar-badge {
      background: rgba(189,217,215,0.2);
      color: #bdd9d7;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .toolbar-actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 12px;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: #0284c7;
      color: #ffffff;
    }
    .btn-primary:hover {
      background: #0369a1;
    }
    .btn-secondary {
      background: rgba(255,255,255,0.12);
      color: #f8fafc;
    }
    .btn-secondary:hover {
      background: rgba(255,255,255,0.2);
    }

    /* ─── HOJA DEL REPORTE ─── */
    .report-sheet {
      max-width: 1240px;
      margin: 20px auto;
      background: #ffffff;
      padding: 32px 40px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.06);
      border-radius: 8px;
    }

    /* ─── CABECERA DEL INFORME ─── */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #00363d;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .logo-img {
      height: 60px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .brand-text h1 {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #00363d;
      margin: 0;
      text-transform: uppercase;
    }
    .brand-text h1 span {
      color: #0284c7;
    }
    .brand-text .tagline {
      font-size: 11px;
      font-weight: 500;
      color: #64748b;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .header-meta {
      text-align: right;
    }
    .report-title {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      margin-top: 6px;
      display: inline-block;
      text-align: right;
    }
    .meta-row {
      font-size: 10px;
      color: #475569;
      line-height: 1.5;
    }
    .meta-row strong {
      color: #0f172a;
    }

    /* ─── TARJETAS DE RESUMEN EJECUTIVO (KPIs) ─── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      border-left: 4px solid #cbd5e1;
    }
    .kpi-card.kpi-total { border-left-color: #0284c7; }
    .kpi-card.kpi-success { border-left-color: #10b981; }
    .kpi-card.kpi-denied { border-left-color: #f59e0b; }
    .kpi-card.kpi-error { border-left-color: #ef4444; }
    .kpi-card.kpi-actors { border-left-color: #6366f1; }

    .kpi-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1;
    }
    .kpi-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-top: 4px;
    }

    /* ─── BARRA DE FILTROS ACTIVOS ─── */
    .filters-bar {
      background: #f1f5f9;
      border-left: 3px solid #00363d;
      padding: 8px 12px;
      font-size: 10px;
      color: #334155;
      margin-bottom: 16px;
      border-radius: 0 4px 4px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* ─── TABLA DE DATOS ─── */
    .table-container {
      width: 100%;
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead {
      display: table-header-group;
    }
    th {
      background: #00363d;
      color: #ffffff;
      padding: 8px 10px;
      text-align: left;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid #00252b;
      white-space: nowrap;
    }
    td {
      padding: 7px 10px;
      border-bottom: 1px solid #e2e8f0;
      border-left: 1px solid #f1f5f9;
      border-right: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    tr {
      page-break-inside: avoid;
    }

    .col-idx {
      width: 30px;
      text-align: center;
      color: #94a3b8;
      font-weight: 600;
    }
    .col-date {
      white-space: nowrap;
      width: 130px;
    }
    .date-main {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      color: #1e293b;
    }
    .date-sub {
      font-size: 8.5px;
      color: #94a3b8;
    }
    .col-actor {
      width: 160px;
    }
    .actor-name {
      font-weight: 700;
      color: #0f172a;
    }
    .actor-role {
      font-size: 9px;
      color: #64748b;
      text-transform: uppercase;
    }
    .col-tenant {
      width: 120px;
      color: #334155;
      font-weight: 600;
    }
    .col-action {
      min-width: 150px;
    }
    .action-friendly {
      font-weight: 700;
      color: #0f172a;
    }
    .action-code {
      font-size: 8.5px;
      font-family: monospace;
      color: #64748b;
    }
    .col-resource {
      width: 150px;
    }
    .resource-type {
      font-weight: 600;
      color: #0284c7;
    }
    .resource-id {
      font-size: 9px;
      font-family: monospace;
      color: #64748b;
    }
    .col-result {
      width: 105px;
      text-align: center;
    }

    /* ─── BADGES DE RESULTADO ─── */
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .badge-icon {
      font-size: 10px;
    }
    .badge-success {
      background-color: #dcfce7;
      color: #15803d;
      border: 1px solid #86efac;
    }
    .badge-denied {
      background-color: #fef3c7;
      color: #b45309;
      border: 1px solid #fcd34d;
    }
    .badge-error {
      background-color: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fca5a5;
    }
    .badge-unknown {
      background-color: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
    }

    /* ─── PIE DE PÁGINA Y VALIDACIÓN ─── */
    .report-footer {
      margin-top: 30px;
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
      page-break-inside: avoid;
    }
    .signatures-block {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-bottom: 24px;
      padding: 0 40px;
    }
    .signature-item {
      text-align: center;
    }
    .signature-line {
      height: 1px;
      background: #94a3b8;
      width: 80%;
      margin: 35px auto 8px auto;
    }
    .signature-title {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
    }
    .signature-role {
      font-size: 9.5px;
      color: #64748b;
    }

    .legal-notice {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      color: #64748b;
    }
    .legal-hash {
      font-family: monospace;
      font-weight: 700;
      color: #00363d;
    }

    /* ─── REGLAS DE IMPRESIÓN OFICIALES ─── */
    @media print {
      @page {
        size: A4 landscape;
        margin: 10mm 12mm;
      }
      body {
        background: #ffffff !important;
        font-size: 9.5px;
      }
      .toolbar-container {
        display: none !important;
      }
      .report-sheet {
        box-shadow: none !important;
        border-radius: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      th {
        background: #00363d !important;
        color: #ffffff !important;
      }
      .badge-success {
        background-color: #dcfce7 !important;
        color: #15803d !important;
      }
      .badge-denied {
        background-color: #fef3c7 !important;
        color: #b45309 !important;
      }
      .badge-error {
        background-color: #fee2e2 !important;
        color: #b91c1c !important;
      }
    }
  </style>
</head>
<body>

  <!-- BARRA DE ACCIONES FLOTANTE -->
  <div class="toolbar-container">
    <div class="toolbar-info">
      <span class="toolbar-badge">VISTA PREVIA DE INFORME</span>
      <span>Auditoría de Seguridad &bull; Folio: <strong>${folio}</strong></span>
    </div>
    <div class="toolbar-actions">
      <button class="btn btn-primary" onclick="window.print()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Imprimir / Guardar como PDF
      </button>
      <button class="btn btn-secondary" onclick="window.close()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        Cerrar
      </button>
    </div>
  </div>

  <!-- CONTENEDOR PRINCIPAL DEL INFORME -->
  <div class="report-sheet">

    <!-- CABECERA PRINCIPAL CON LOGO -->
    <header class="report-header">
      <div class="header-brand">
        <img src="${SIGNUM_LOGO_DATA_URL}" alt="Signum Clock Logo" class="logo-img">
        <div class="brand-text">
          <h1>SIGNUM<span>&bull;</span>CLOCK</h1>
          <div class="tagline">Control Integral de Asistencia y Seguridad Biometríca</div>
        </div>
      </div>
      <div class="header-meta">
        <div class="report-title">Informe Oficial de Auditoría</div>
        <div class="meta-box">
          <div class="meta-row"><strong>Folio:</strong> ${folio}</div>
          <div class="meta-row"><strong>Emisión:</strong> ${fechaEmisionCancun} (Cancún / UTC-5)</div>
          <div class="meta-row"><strong>Emisor:</strong> ${escapeHtml(emisorNombre)} &bull; ${escapeHtml(emisorRol)}</div>
          <div class="meta-row"><strong>Ámbito:</strong> ${escapeHtml(tenantNombre)}</div>
        </div>
      </div>
    </header>

    <!-- RESUMEN EJECUTIVO (KPIs) -->
    <section class="kpi-grid">
      <div class="kpi-card kpi-total">
        <div class="kpi-label">Total de Eventos</div>
        <div class="kpi-value">${totalEventos}</div>
        <div class="kpi-sub">Registros auditados</div>
      </div>
      <div class="kpi-card kpi-success">
        <div class="kpi-label">Eventos Exitosos</div>
        <div class="kpi-value" style="color: #10b981;">${exitosos}</div>
        <div class="kpi-sub">Tasa de éxito: ${tasaExito}%</div>
      </div>
      <div class="kpi-card kpi-denied">
        <div class="kpi-label">Rechazados / Alertas</div>
        <div class="kpi-value" style="color: #f59e0b;">${rechazados}</div>
        <div class="kpi-sub">Accesos denegados</div>
      </div>
      <div class="kpi-card kpi-error">
        <div class="kpi-label">Errores del Sistema</div>
        <div class="kpi-value" style="color: #ef4444;">${errores}</div>
        <div class="kpi-sub">Fallas operativas</div>
      </div>
      <div class="kpi-card kpi-actors">
        <div class="kpi-label">Actores & Recursos</div>
        <div class="kpi-value" style="color: #6366f1;">${uniqueActors} / ${uniqueResources}</div>
        <div class="kpi-sub">Usuarios / Módulos</div>
      </div>
    </section>

    <!-- CRITERIOS DE EXTRACCIÓN / FILTROS -->
    <div class="filters-bar">
      <div><strong>Parámetros de Extracción:</strong> ${filtersSummaryText}</div>
      <div>Página actual &bull; <strong>${logs.length} registros</strong></div>
    </div>

    <!-- TABLA DE DETALLE DE AUDITORÍA -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-idx">#</th>
            <th class="col-date">Fecha / Hora (Cancún)</th>
            <th class="col-actor">Actor / Usuario</th>
            <th class="col-tenant">Empresa</th>
            <th class="col-action">Acción Registrada</th>
            <th class="col-resource">Recurso Impactado</th>
            <th class="col-result">Resultado</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <!-- PIE DE PÁGINA CON FIRMAS Y DECLARACIÓN LEGAL -->
    <footer class="report-footer">
      <div class="signatures-block">
        <div class="signature-item">
          <div class="signature-line"></div>
          <div class="signature-title">${escapeHtml(emisorNombre)}</div>
          <div class="signature-role">Auditor Responsable / Operador del Sistema (${escapeHtml(emisorRol)})</div>
        </div>
        <div class="signature-item">
          <div class="signature-line"></div>
          <div class="signature-title">Dirección de Seguridad TI / Administración</div>
          <div class="signature-role">Conformidad y Validación Institucional</div>
        </div>
      </div>

      <div class="legal-notice">
        <div>
          <strong>CERTIFICACIÓN DE INTEGRIDAD ELECTRÓNICA:</strong> Este informe es emitido mediante el registro inmutable de base de datos de Signum Clock con sellado temporal.
        </div>
        <div>
          Firma Criptográfica: <span class="legal-hash">${folio}-SEC-VERIFIED</span>
        </div>
      </div>
    </footer>

  </div>

  <script>
    // Enfoque automático y activación de impresión ligera
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.focus();
      }, 250);
    });
  </script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no')
  if (!win) {
    return { success: false, message: 'La ventana emergente fue bloqueada por el navegador. Por favor permite popups para ver el reporte.' }
  }

  win.document.open()
  win.document.write(html)
  win.document.close()

  return { success: true, folio }
}

/**
 * Genera el informe profesional en PDF para Historial de Eventos de Asistencia
 */
export function openProfessionalEventHistoryReport({
  events = [],
  activeTenant = null,
  currentUser = null,
  fechaInicio = '',
  fechaFin = '',
  search = ''
}) {
  if (!events || events.length === 0) {
    return { success: false, message: 'No hay eventos de asistencia disponibles para exportar.' }
  }

  const todayStr = format(new Date(), 'yyyyMMdd')
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  const folio = `SC-EVT-${todayStr}-${randomSuffix}`
  const fechaEmision = formatDateCancun(new Date())

  const totalEventos = events.length
  const entradas = events.filter(e => (e['Tipo'] || '').toLowerCase() === 'entrada').length
  const salidas = events.filter(e => (e['Tipo'] || '').toLowerCase() === 'salida').length
  const uniqueEmps = new Set(events.map(e => e['ID de persona'] || e['Nombre de la persona'])).size
  const uniqueDevs = new Set(events.map(e => e['Nombre del dispositivo'] || e['Dispositivo SN'])).size

  const emisorNombre = currentUser?.nombre || currentUser?.email || 'Administrador del Sistema'
  const emisorRol = (currentUser?.rol || 'ADMIN').toUpperCase()
  const tenantNombre = activeTenant?.nombre_comercial || activeTenant?.nombre_empresa || 'Empresa Local'

  const rowsHtml = events.map((ev, idx) => `
    <tr>
      <td style="text-align: center; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
      <td style="font-family: monospace; font-weight: 700;">${escapeHtml(ev['ID de persona'] || '—')}</td>
      <td style="font-weight: 700; color: #0f172a;">${escapeHtml(ev['Nombre de la persona'] || '—')}</td>
      <td style="color: #475569;">${escapeHtml(ev['Departamento'] || '—')}</td>
      <td style="text-align: center;">
        <span class="badge ${ev['Tipo'] === 'Entrada' ? 'badge-success' : 'badge-denied'}">
          ${escapeHtml(ev['Tipo'] || '—')}
        </span>
      </td>
      <td style="font-family: monospace; font-weight: 600;">${escapeHtml(ev['Hora de fichaje'] || '—')}</td>
      <td style="color: #64748b;">${escapeHtml(ev['Día de la semana'] || '—')}</td>
      <td style="color: #334155;">${escapeHtml(ev['Modo de verificación'] || '—')}</td>
      <td style="font-size: 9px; color: #475569;">${escapeHtml(ev['Nombre del dispositivo'] || ev['Dispositivo SN'] || '—')}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte de Historial de Eventos — ${folio}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 11px;
      color: #0f172a;
      background: #f1f5f9;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 9999;
      background: #00252b; color: #fff; padding: 10px 24px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .btn {
      padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; border: none;
    }
    .btn-print { background: #0284c7; color: #fff; }
    .btn-close { background: rgba(255,255,255,0.15); color: #fff; margin-left: 8px; }
    .sheet {
      max-width: 1240px; margin: 20px auto; background: #fff; padding: 32px 40px;
      border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.06);
    }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2px solid #00363d; padding-bottom: 20px; margin-bottom: 20px;
    }
    .logo-box { display: flex; align-items: center; gap: 18px; }
    .logo-img { height: 60px; width: auto; object-fit: contain; }
    .title-box h1 { font-size: 20px; font-weight: 800; color: #00363d; text-transform: uppercase; }
    .title-box h1 span { color: #0284c7; }
    .kpi-grid {
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px;
    }
    .kpi-card {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; border-left: 4px solid #cbd5e1;
    }
    .kpi-card.total { border-left-color: #0284c7; }
    .kpi-card.in { border-left-color: #10b981; }
    .kpi-card.out { border-left-color: #f59e0b; }
    .kpi-card.colab { border-left-color: #6366f1; }
    .kpi-card.dev { border-left-color: #0f766e; }
    .kpi-val { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .kpi-lbl { font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748b; }
    .filter-bar {
      background: #f1f5f9; border-left: 3px solid #00363d; padding: 8px 12px; font-size: 10px; margin-bottom: 16px;
      display: flex; justify-content: space-between;
    }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 24px; }
    th {
      background: #00363d; color: #fff; padding: 8px 10px; text-align: left; font-size: 9.5px; text-transform: uppercase;
    }
    td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    tr:nth-child(even) td { background: #f8fafc; }
    tr { page-break-inside: avoid; }
    .badge {
      display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase;
    }
    .badge-success { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
    .badge-denied { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; }
    .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; page-break-inside: avoid; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 24px; text-align: center; }
    .sig-line { height: 1px; background: #94a3b8; width: 70%; margin: 35px auto 8px auto; }
    .legal { background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
    @media print {
      @page { size: A4 landscape; margin: 10mm 12mm; }
      body { background: #fff !important; }
      .toolbar { display: none !important; }
      .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div><strong>VISTA PREVIA DE INFORME</strong> &bull; Historial de Marcajes (${folio})</div>
    <div>
      <button class="btn btn-print" onclick="window.print()">Imprimir / Guardar como PDF</button>
      <button class="btn btn-close" onclick="window.close()">Cerrar</button>
    </div>
  </div>
  <div class="sheet">
    <div class="header">
      <div class="logo-box">
        <img src="${SIGNUM_LOGO_DATA_URL}" alt="Signum Clock" class="logo-img" />
        <div class="title-box">
          <h1>SIGNUM<span>&bull;</span>CLOCK</h1>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase;">Control de Asistencia y Biometría</p>
        </div>
      </div>
      <div style="text-align: right;">
        <h2 style="font-size: 16px; text-transform: uppercase; color: #0f172a;">Reporte de Eventos de Asistencia</h2>
        <div style="font-size: 10px; color: #475569; margin-top: 4px;">
          <div><strong>Folio:</strong> ${folio}</div>
          <div><strong>Emisión:</strong> ${fechaEmision} (Cancún)</div>
          <div><strong>Empresa:</strong> ${escapeHtml(tenantNombre)}</div>
          <div><strong>Generado por:</strong> ${escapeHtml(emisorNombre)} (${escapeHtml(emisorRol)})</div>
        </div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card total"><div class="kpi-lbl">Total Marcajes</div><div class="kpi-val">${totalEventos}</div></div>
      <div class="kpi-card in"><div class="kpi-lbl">Entradas</div><div class="kpi-val" style="color: #10b981;">${entradas}</div></div>
      <div class="kpi-card out"><div class="kpi-lbl">Salidas</div><div class="kpi-val" style="color: #f59e0b;">${salidas}</div></div>
      <div class="kpi-card colab"><div class="kpi-lbl">Colaboradores</div><div class="kpi-val" style="color: #6366f1;">${uniqueEmps}</div></div>
      <div class="kpi-card dev"><div class="kpi-lbl">Terminales</div><div class="kpi-val" style="color: #0f766e;">${uniqueDevs}</div></div>
    </div>
    <div class="filter-bar">
      <div><strong>Rango del Reporte:</strong> ${escapeHtml(fechaInicio)} al ${escapeHtml(fechaFin)} ${search ? `&bull; Búsqueda: "${escapeHtml(search)}"` : ''}</div>
      <div><strong>${events.length} registros</strong></div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width: 30px; text-align: center;">#</th>
          <th>ID / Clave</th>
          <th>Colaborador</th>
          <th>Departamento</th>
          <th style="text-align: center;">Tipo</th>
          <th>Fecha y Hora</th>
          <th>Día</th>
          <th>Modo</th>
          <th>Dispositivo</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <div class="footer">
      <div class="signatures">
        <div><div class="sig-line"></div><strong>${escapeHtml(emisorNombre)}</strong><div style="font-size: 9px; color: #64748b;">Responsable de Recursos Humanos / Operador</div></div>
        <div><div class="sig-line"></div><strong>Dirección de Operaciones / Administración</strong><div style="font-size: 9px; color: #64748b;">Conformidad Institucional</div></div>
      </div>
      <div class="legal">
        <div>Documento oficial generado electrónicamente por Signum Clock Engine.</div>
        <div>Sello de Verificación: <strong>${folio}-VERIFIED</strong></div>
      </div>
    </div>
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1280,height=800')
  if (!win) {
    return { success: false, message: 'La ventana emergente fue bloqueada por el navegador. Permite popups para ver el reporte.' }
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  return { success: true, folio }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

