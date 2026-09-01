// backend/sync-server.js
require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
//  SIGNUM-CLOCK · Servidor HTTP para sincronización de colaboradores externos
//
//  Endpoints:
//   POST /api/sync/test        → Probar conexión con API Consolide
//   POST /api/sync/preview     → Vista previa de colaboradores (dry-run)
//   POST /api/sync/execute     → Ejecutar sincronización real
//
//  SEGURIDAD:
//   - Bearer Token de Consolide NUNCA sale del servidor
//   - El frontend envía su JWT de Supabase para autenticarse
//   - El JWT se verifica para extraer el cliente_id del tenant
//   - Todas las operaciones DB están filtradas por cliente_id
//
//  ARQUITECTURA:
//   Frontend → POST /api/sync/* (con Supabase JWT)
//       ↓
//   sync-server.js (valida JWT → extrae cliente_id)
//       ↓
//   employee-sync-service.js (lógica de negocio)
//       ↓
//   consolide-client.js (llama API externa con Bearer Token privado)
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const http = require('http')

const PORT = parseInt(process.env.SYNC_SERVER_PORT || '3001', 10)

const SUPABASE_URL             = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Roles permitidos para ejecutar sincronización
const ALLOWED_ROLES = new Set(['admin', 'rh', 'superadmin'])

// ── Utilidades de respuesta ───────────────────────────────────────────────────
function send(res, statusCode, body) {
  const json = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type':                'application/json',
    'Content-Length':              Buffer.byteLength(json),
    'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
  })
  res.end(json)
}

function sendError(res, statusCode, message) {
  send(res, statusCode, { ok: false, error: message })
}

// ── Parsear body JSON ─────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > 64 * 1024) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

// ── Validar JWT de Supabase y extraer cliente_id ──────────────────────────────
// Usamos Supabase REST API para verificar el JWT sin dependencia de librerías JWT
async function verifySupabaseToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authorization header requerido'), { statusCode: 401 })
  }

  const token = authHeader.slice(7)
  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verificar token con Supabase admin API
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw Object.assign(new Error('Token de sesión inválido o expirado'), { statusCode: 401 })
  }

  // Obtener cliente_id y rol del perfil del usuario
  const { data: perfil, error: perfilError } = await supabase
    .from('usuarios_perfiles')
    .select('cliente_id, rol')
    .eq('id', user.id)
    .single()

  if (perfilError) {
    throw Object.assign(new Error('No se encontró el perfil del usuario'), { statusCode: 403 })
  }
  
  if (!perfil.cliente_id && perfil.rol !== 'superadmin' && perfil.rol !== 'admin') {
    throw Object.assign(new Error('El usuario no tiene una empresa asignada'), { statusCode: 403 })
  }

  if (!ALLOWED_ROLES.has(perfil.rol)) {
    throw Object.assign(
      new Error('No tienes permisos para ejecutar sincronizaciones'),
      { statusCode: 403 }
    )
  }

  return { userId: user.id, clienteId: perfil.cliente_id, rol: perfil.rol }
}

// ── Manejadores de rutas ──────────────────────────────────────────────────────
const { testConnection }   = require('./consolide-client')
const { syncEmpleados }    = require('./employee-sync-service')
const { ConsolideApiError } = require('./consolide-client')

async function handleTest(req, res) {
  await verifySupabaseToken(req.headers['authorization'])
  const result = await testConnection()
  send(res, result.ok ? 200 : 502, result)
}

async function handlePreview(req, res, body, authHeader) {
  const { clienteId, rol } = await verifySupabaseToken(authHeader)
  let { fechaInicio, fechaFin, trabId, targetClienteId } = body

  // Si es superadmin o admin, puede consultar otra empresa pasando targetClienteId
  const finalClienteId = (rol === 'superadmin' || rol === 'admin') && targetClienteId ? targetClienteId : clienteId

  if (!finalClienteId) {
    return sendError(res, 400, 'No se ha especificado un cliente_id válido')
  }

  if (trabId) {
    // Si se provee un trabId específico, las fechas pueden ser opcionales,
    // pero la API podría requerirlas, así que usamos un rango amplio si no vienen.
    fechaInicio = fechaInicio || '2000-01-01'
    fechaFin    = fechaFin    || '2099-12-31'
  } else if (!fechaInicio || !fechaFin) {
    return sendError(res, 400, 'fechaInicio y fechaFin son requeridos (formato YYYY-MM-DD) para consulta general')
  }

  const result = await syncEmpleados({
    clienteId: finalClienteId,
    fechaInicio,
    fechaFin,
    trabId,
    dryRun: true,
  })

  send(res, 200, { ok: true, ...result })
}

async function handleExecute(req, res, body, authHeader) {
  const { clienteId, rol } = await verifySupabaseToken(authHeader)
  let { fechaInicio, fechaFin, trabId, targetClienteId } = body

  const finalClienteId = (rol === 'superadmin' || rol === 'admin') && targetClienteId ? targetClienteId : clienteId

  if (!finalClienteId) {
    return sendError(res, 400, 'No se ha especificado un cliente_id válido')
  }

  if (trabId) {
    fechaInicio = fechaInicio || '2000-01-01'
    fechaFin    = fechaFin    || '2099-12-31'
  } else if (!fechaInicio || !fechaFin) {
    return sendError(res, 400, 'fechaInicio y fechaFin son requeridos (formato YYYY-MM-DD) para consulta general')
  }

  const result = await syncEmpleados({
    clienteId: finalClienteId,
    fechaInicio,
    fechaFin,
    trabId,
    dryRun: false,
  })

  send(res, 200, { ok: true, ...result })
}

// ── Servidor HTTP ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    return res.end()
  }

  if (method !== 'POST') {
    return sendError(res, 405, 'Method Not Allowed')
  }

  try {
    const body = await parseBody(req)
    const auth = req.headers['authorization']

    if (url === '/api/sync/test') {
      return await handleTest(req, res)
    }
    if (url === '/api/sync/preview') {
      return await handlePreview(req, res, body, auth)
    }
    if (url === '/api/sync/execute') {
      return await handleExecute(req, res, body, auth)
    }

    return sendError(res, 404, 'Endpoint no encontrado')

  } catch (err) {
    // ConsolideApiError
    if (err.name === 'ConsolideApiError') {
      return sendError(res, err.statusCode || 502, err.message)
    }
    // Auth/permission errors
    if (err.statusCode) {
      return sendError(res, err.statusCode, err.message)
    }
    // Errores internos — loguear en servidor, mensaje genérico al cliente
    console.error('[SYNC-SERVER] Error interno:', err.message)
    return sendError(res, 500, 'Error interno del servidor de sincronización')
  }
})

server.on('error', (err) => {
  console.error('[SYNC-SERVER] Error fatal:', err.message)
  process.exit(1)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🔄 Servidor de Sincronización iniciado`)
  console.log(`  📡 Escuchando en puerto HTTP ${PORT}`)
  console.log(`  🏢 API Consolide: ${process.env.CONSOLIDE_API_URL || 'https://qa.consolide.com.mx'}`)
  console.log(`  🔐 Token: [protegido en servidor]\n`)
})

module.exports = server  // exportar para tests
