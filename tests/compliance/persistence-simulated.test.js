import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { WorkdayReprocessService } from '../../src/services/attendance/WorkdayReprocessService.ts'

/**
 * Mock para simular el comportamiento de Reprocess Service y las lecturas a DB.
 * Para evitar dependencia de un ambiente local de Docker/Supabase en CI.
 */
describe('FASE 2: Datos Simulados (TEST-001 a TEST-003)', () => {

  const SIGNUM_TEST_COMPANY = 't-signum-test'
  const EMP_PUNTUAL = 'e-puntual'
  const EMP_RETARDO = 'e-retardo'
  const EMP_INCOMPLETO = 'e-incompleto'

  // Mock del Supabase client usado en el reprocess service
  const supabaseClient = {
    from: (table) => {
      const builder = {
        select: () => builder,
        eq: (f, v) => {
          if (table === 'empleados' && f === 'id' && v) {
            builder._empId = v
          }
          if (table === 'attendance_logs' && f === 'biometric_user_id') {
            builder._biomId = v
          }
          return builder
        },
        lte: () => builder,
        limit: () => builder,
        single: async () => {
          if (table === 'empleados') {
            if (builder._empId) {
              return { data: { hikvision_device_userid: builder._empId === EMP_PUNTUAL || builder._empId === EMP_RETARDO || builder._empId === EMP_INCOMPLETO ? builder._empId : 'biom-id' }, error: null }
            }
            return { error: 'Not found' }
          }
        },
        maybeSingle: async () => {
          if (table === 'empleados_horarios') {
            return {
              data: {
                horarios: {
                  id: 'sch-test',
                  nombre: 'Turno Prueba',
                  tolerancia_minutos: 10,
                  dias_config: {
                    mar: { activo: true, entrada: '08:00', salida: '17:00' } // 2027-02-23 es martes
                  }
                }
              },
              error: null
            }
          }
        },
        then: async (resolve) => {
          if (table === 'attendance_logs') {
            let punches = []
            if (builder._biomId === EMP_PUNTUAL) {
              punches = [
                { id: 'l1', timestamp: '2027-02-23T14:00:00.000Z', in_out_state: 0 },
                { id: 'l2', timestamp: '2027-02-23T23:00:00.000Z', in_out_state: 1 }
              ]
            } else if (builder._biomId === EMP_RETARDO) {
              punches = [
                { id: 'l3', timestamp: '2027-02-23T14:20:00.000Z', in_out_state: 0 },
                { id: 'l4', timestamp: '2027-02-23T23:00:00.000Z', in_out_state: 1 }
              ]
            } else if (builder._biomId === EMP_INCOMPLETO) {
              punches = [
                { id: 'l5', timestamp: '2027-02-23T14:00:00.000Z', in_out_state: 0 }
              ]
            }
            resolve({ data: punches.map(p => ({ ...p, cliente_id: SIGNUM_TEST_COMPANY, numero_serie: 'DEV-1', verify_type: 1 })), error: null })
          }
        }
      }
      return builder
    },
    // Mock RPC (solo captura la llamada para asertar)
    rpc: async (func, args) => {
      if (func === 'upsert_workday_record') {
        return { data: { status: 'CREATED', workday_record_id: 'rec-1', version: 1 }, error: null }
      }
    }
  }
  
  // Para capturar los payloads enviados a upsert_workday_record
  let lastPayload = null
  const originalRpc = supabaseClient.rpc
  supabaseClient.rpc = async (func, args) => {
    lastPayload = args.payload
    return originalRpc(func, args)
  }

  test('TEST-001: Jornada puntual simulada procesa y persiste exitosamente', async () => {
    const res = await WorkdayReprocessService.processWorkday({
      supabaseClient,
      clienteId: SIGNUM_TEST_COMPANY,
      empleadoId: EMP_PUNTUAL,
      workdayDate: '2027-02-23'
    })
    
    assert.equal(res.status, 'CREATED')
    assert.equal(lastPayload.workday_state, 'COMPLETE')
    assert.equal(lastPayload.late_minutes, 0)
    assert.equal(lastPayload.early_leave_minutes, 0)
    assert.equal(lastPayload.incidents.length, 1)
    assert.equal(lastPayload.incidents[0].code, 'OVERTIME_DETECTED')
  })

  test('TEST-002: Jornada con retardo detecta late_minutes y LATE incident', async () => {
    const res = await WorkdayReprocessService.processWorkday({
      supabaseClient,
      clienteId: SIGNUM_TEST_COMPANY,
      empleadoId: EMP_RETARDO,
      workdayDate: '2027-02-23'
    })
    
    assert.equal(res.status, 'CREATED')
    assert.equal(lastPayload.workday_state, 'COMPLETE')
    // Llegó 08:20 -> tolerancia 10min -> retardo total de 20min desde la programada (ATT-005)
    assert.equal(lastPayload.late_minutes, 20)
    assert.ok(lastPayload.incidents.some(i => i.code === 'LATE'))
  })

  test('TEST-003: Jornada incompleta genera MISSING_EXIT', async () => {
    const res = await WorkdayReprocessService.processWorkday({
      supabaseClient,
      clienteId: SIGNUM_TEST_COMPANY,
      empleadoId: EMP_INCOMPLETO,
      workdayDate: '2027-02-23'
    })
    
    assert.equal(res.status, 'CREATED')
    assert.equal(lastPayload.workday_state, 'INCOMPLETE')
    assert.ok(lastPayload.incidents.some(i => i.code === 'MISSING_EXIT'))
  })
})
