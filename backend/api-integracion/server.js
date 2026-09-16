'use strict'

require('dotenv').config({ quiet: true })

const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const { testConnection } = require('./consolide-client')
const { syncEmpleados } = require('./employee-sync-service')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
const ALLOWED_ROLES = new Set(['admin', 'rh', 'superadmin'])
const supabaseAuthOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Faltan variables de entorno requeridas: SUPABASE_URL y/o SUPABASE_SECRET_KEY')
}

const app = express()
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '64kb', type: '*/*' }))

async function verifySupabaseToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authorization header requerido'), { statusCode: 401 })
  }

  const token = authHeader.slice(7)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, supabaseAuthOptions)
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw Object.assign(new Error('Token de sesión inválido o expirado'), { statusCode: 401 })
  }

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
    throw Object.assign(new Error('No tienes permisos para ejecutar sincronizaciones'), { statusCode: 403 })
  }

  return { userId: user.id, clienteId: perfil.cliente_id, rol: perfil.rol }
}

function resolveClienteId({ clienteId, rol }, targetClienteId) {
  return rol === 'superadmin' && targetClienteId
    ? targetClienteId
    : clienteId
}

function normalizeRequest(body) {
  let { fechaInicio, fechaFin, trabId, targetClienteId } = body || {}
  if (trabId) {
    fechaInicio = fechaInicio || '2000-01-01'
    fechaFin = fechaFin || '2099-12-31'
  } else if (!fechaInicio || !fechaFin) {
    throw Object.assign(new Error('fechaInicio y fechaFin son requeridos (formato YYYY-MM-DD) para consulta general'), { statusCode: 400 })
  }
  return { fechaInicio, fechaFin, trabId, targetClienteId }
}

app.post('/api/sync/test', async (req, res, next) => {
  try {
    await verifySupabaseToken(req.get('authorization'))
    const result = await testConnection()
    res.status(result.ok ? 200 : 502).json(result)
  } catch (error) {
    next(error)
  }
})

async function handleSync(req, res, dryRun) {
  const identity = await verifySupabaseToken(req.get('authorization'))
  const { fechaInicio, fechaFin, trabId, targetClienteId } = normalizeRequest(req.body)
  const finalClienteId = resolveClienteId(identity, targetClienteId)

  if (!finalClienteId) {
    throw Object.assign(new Error('No se ha especificado un cliente_id válido'), { statusCode: 400 })
  }

  const result = await syncEmpleados({
    clienteId: finalClienteId,
    fechaInicio,
    fechaFin,
    trabId,
    dryRun,
  })
  res.status(200).json({ ok: true, ...result })
}

app.post('/api/sync/preview', async (req, res, next) => {
  try {
    await handleSync(req, res, true)
  } catch (error) {
    next(error)
  }
})

app.post('/api/sync/execute', async (req, res, next) => {
  try {
    await handleSync(req, res, false)
  } catch (error) {
    next(error)
  }
})

app.use((req, res) => {
  res.status(req.method === 'POST' ? 404 : 405).json({
    ok: false,
    error: req.method === 'POST' ? 'Endpoint no encontrado' : 'Method Not Allowed',
  })
})

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' })
  }
  if (error.name === 'ConsolideApiError') {
    return res.status(error.statusCode || 502).json({ ok: false, error: error.message })
  }
  if (error.statusCode) {
    return res.status(error.statusCode).json({ ok: false, error: error.message })
  }
  console.error('[API-INTEGRACION] Error interno:', error.message)
  return res.status(500).json({ ok: false, error: 'Error interno del servidor de sincronización' })
})

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3001', 10)
  app.listen(port, () => {
    console.log(`[API-INTEGRACION] Escuchando localmente en el puerto ${port}`)
  })
}

module.exports = app
