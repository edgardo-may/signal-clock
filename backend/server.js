// backend/server.js
require('dotenv').config()
// ──────────────────────────────────────────────────────────────────────────────
//  SIGNUM-CLOCK · Dual Protocol Server (Hikvision ISUP 5.0 + ZKTeco ADMS)
//  Descripción: Servidor Node.js que levanta:
//    1. Servidor TCP (Puerto 7660) para escuchar Hikvision
//    2. Servidor HTTP (Puerto 8080) para escuchar ZKTeco
//  Ambos insertan los logs crudos en 'attendance_logs' de Supabase.
// ──────────────────────────────────────────────────────────────────────────────

'use strict'

const net = require('net')
const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

// ── Config ────────────────────────────────────────────────────────────────────
const ISUP_PORT = parseInt(process.env.ISUP_PORT ?? '7660', 10)
const ZK_PORT = parseInt(process.env.ZK_PORT ?? '8080', 10)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[ERROR] Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ──────────────────────────────────────────────────────────────────────────────
//  HIKVISION (TCP SERVER)
// ──────────────────────────────────────────────────────────────────────────────

function parseISUPFrame(rawBuffer) {
  const raw = rawBuffer.toString('utf-8')

  try {
    const json = JSON.parse(raw)
    return {
      deviceId:   json.deviceId   ?? json.device_id ?? null,
      userId:     json.userId     ?? json.user_id   ?? null,
      eventType:  json.eventType  ?? '0',
      method:     json.method     ?? 'rostro',
      timestamp:  json.timestamp  ?? new Date().toISOString(),
      rawText:    raw
    }
  } catch (_) { /* no JSON, intentar XML simplificado */ }

  const extract = (tag) => {
    const match = raw.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`))
    return match ? match[1].trim() : null
  }

  return {
    deviceId:  extract('deviceID')  ?? extract('DeviceID'),
    userId:    extract('employeeNo') ?? extract('UserID'),
    eventType: extract('eventType') ?? '0',
    method:    extract('cardType')  ?? extract('verifyMode') ?? 'tarjeta',
    timestamp: extract('dateTime')  ?? new Date().toISOString(),
    rawText:   raw
  }
}

async function insertarLogHikvision(frame) {
  const { deviceId, userId, eventType, timestamp, rawText } = frame

  if (!deviceId || !userId) return

  // Buscar cliente_id del dispositivo (hikvision)
  const { data: dispositivo } = await supabase
    .from('dispositivos')
    .select('cliente_id, numero_serie')
    .or(`numero_serie.eq.${deviceId},device_id_hikvision.eq.${deviceId}`)
    .eq('estatus', 'activo')
    .single()

  if (!dispositivo) {
    console.warn(`[Hikvision] Dispositivo "${deviceId}" no encontrado.`)
    return
  }

  // Insertar en attendance_logs (el trigger procesará a registro_asistencia)
  const { error } = await supabase
    .from('attendance_logs')
    .insert({
      cliente_id: dispositivo.cliente_id,
      numero_serie: dispositivo.numero_serie || deviceId,
      biometric_user_id: userId,
      timestamp: timestamp,
      verify_type: parseInt(eventType, 10) || 0,
      in_out_state: 0,
      raw_data: rawText
    })

  if (error) {
    if (error.code !== '23505') console.error('[Hikvision ERROR]', error.message)
  } else {
    console.log(`[Hikvision OK] Marcaje: Dispositivo ${deviceId}, Usuario ${userId}`)
  }
}

const tcpServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    try {
      const frame = parseISUPFrame(buffer)
      if (frame.deviceId) {
        insertarLogHikvision(frame).catch(console.error)
        buffer = Buffer.alloc(0)
      }
    } catch (e) { }
  })
  socket.on('error', () => {})
})

tcpServer.listen(ISUP_PORT, '0.0.0.0', () => {
  console.log(`  [TCP] Servidor Hikvision ISUP 5.0 escuchando en puerto ${ISUP_PORT}`)
})

// ──────────────────────────────────────────────────────────────────────────────
//  ZKTECO (HTTP SERVER - EXPRESS)
// ──────────────────────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.text({ type: '*/*' })) // ZKTeco envía texto plano

// Función Helper para parsear la fecha de ZKTeco a ISO 8601
function parseZKTime(zkTimeStr) {
  // Ej: 2023-09-14 15:30:22
  if (!zkTimeStr) return new Date().toISOString()
  return new Date(zkTimeStr.replace(' ', 'T') + 'Z').toISOString()
}

// 1. Inicialización (GET /iclock/cdata)
app.get('/iclock/cdata', (req, res) => {
  const sn = req.query.SN
  console.log(`[ZKTeco] Inicialización de dispositivo: SN=${sn}`)
  res.send(`GET OPTION FROM: ${sn}\nStamp=9999\nOpStamp=9999\nErrorDelay=60\nDelay=30\nTransTimes=00:00;14:00\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=0`)
})

// 2. Recepción de Datos (POST /iclock/cdata)
app.post('/iclock/cdata', async (req, res) => {
  const sn = req.query.SN
  const table = req.query.table
  const rawData = req.body

  if (table === 'ATTLOG') {
    // Buscar dispositivo para obtener cliente_id
    const { data: dispositivo } = await supabase
      .from('dispositivos')
      .select('cliente_id')
      .eq('numero_serie', sn)
      .single()

    if (!dispositivo) {
      console.warn(`[ZKTeco] Dispositivo desconocido: ${sn}`)
      return res.send('OK')
    }

    // Parsear líneas (Formato: UserID \t DateTime \t State \t VerifyType)
    const lines = rawData.split('\n').map(l => l.trim()).filter(Boolean)
    
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length >= 4) {
        const userId = parts[0]
        const timestamp = parseZKTime(parts[1])
        const state = parseInt(parts[2], 10) || 0
        const verifyType = parseInt(parts[3], 10) || 0

        const { error } = await supabase.from('attendance_logs').insert({
          cliente_id: dispositivo.cliente_id,
          numero_serie: sn,
          biometric_user_id: userId,
          timestamp: timestamp,
          in_out_state: state,
          verify_type: verifyType,
          raw_data: line
        })

        if (!error) {
          console.log(`[ZKTeco OK] Marcaje: SN=${sn}, User=${userId}, Time=${parts[1]}`)
        }
      }
    }
  }

  res.send('OK')
})

// 3. Petición de Comandos (GET /iclock/getrequest)
app.get('/iclock/getrequest', async (req, res) => {
  const sn = req.query.SN

  // Buscar comandos pendientes
  const { data: comandos } = await supabase
    .from('device_commands')
    .select('id, command_string')
    .eq('numero_serie', sn)
    .eq('is_executed', false)
    .order('creado_at', { ascending: true })
    .limit(10)

  if (comandos && comandos.length > 0) {
    let responseText = ''
    for (const cmd of comandos) {
      // El formato de ID ZK es "C:ID"
      responseText += `C:${cmd.id}:${cmd.command_string}\n`
    }
    res.send(responseText)
  } else {
    res.send('OK')
  }
})

// 4. Respuesta de Comandos (POST /iclock/devicecmd)
app.post('/iclock/devicecmd', async (req, res) => {
  const sn = req.query.SN
  const rawData = req.body
  
  // Ej: ID=1&Return=0&CMD=ENROLL_FP
  const lines = rawData.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const match = line.match(/^ID=([^&]+)&Return=([^&]+)&CMD=(.*)$/)
    if (match) {
      const cmdId = match[1]
      const returnCode = match[2]
      
      // Marcar como ejecutado
      await supabase
        .from('device_commands')
        .update({ is_executed: true, executed_at: new Date().toISOString(), return_code: returnCode })
        .eq('id', cmdId)
    }
  }
  
  res.send('OK')
})

app.listen(ZK_PORT, '0.0.0.0', () => {
  console.log(`  [HTTP] Servidor ZKTeco ADMS escuchando en puerto ${ZK_PORT}`)
})

// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n  ██████╗ ██╗ ██████╗ ███╗  ██╗██╗   ██╗███╗  ███╗`)
console.log(`  ██╔═══╝ ██║██╔════╝ ████╗ ██║██║   ██║████╗████║`)
console.log(`  ╚█████╗ ██║██║  ███╗██╔██╗██║██║   ██║██╔████╔██║`)
console.log(`   ╚═══██╗██║██║   ██║██║╚████║██║   ██║██║╚██╔╝██║`)
console.log(`  ██████╔╝██║╚██████╔╝██║ ╚███║╚██████╔╝██║ ╚═╝ ██║`)
console.log(`  ╚═════╝ ╚═╝ ╚═════╝ ╚═╝  ╚══╝ ╚═════╝ ╚═╝     ╚═╝`)
console.log(`\n  Servidor Dual Protocol (Hikvision + ZKTeco) Inicializado\n`)
