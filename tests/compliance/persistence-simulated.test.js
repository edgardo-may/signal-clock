import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { WorkdayReprocessService } from '../../src/services/attendance/WorkdayReprocessService.ts'

/**
 * These fixtures still exercise the historical reprocess entry point, but its
 * browser-reachable persistence boundary is intentionally fail-closed. Phase
 * 35.5C replaces prior mock-RPC write assertions with the current V3 contract:
 * calculation can be requested, while persistence remains backend-only.
 */
describe('FASE 2: Datos Simulados (V3 persistence boundary)', () => {
  const SIGNUM_TEST_COMPANY = 't-signum-test'
  const EMP_PUNTUAL = 'e-puntual'
  const EMP_RETARDO = 'e-retardo'
  const EMP_INCOMPLETO = 'e-incompleto'
  let rpcCalls = 0

  const supabaseClient = {
    from: (table) => {
      const builder = {
        select: () => builder,
        eq: (field, value) => {
          if (table === 'empleados' && field === 'id') builder.employeeId = value
          if (table === 'attendance_logs' && field === 'biometric_user_id') builder.biometricId = value
          return builder
        },
        lte: () => builder,
        gte: () => builder,
        limit: () => builder,
        single: async () => {
          if (table === 'tenant_features') return { data: { state: 'ACTIVE' }, error: null }
          if (table === 'clientes') return { data: { timezone: 'America/Mexico_City' }, error: null }
          if (table === 'empleados') return { data: { device_userid: builder.employeeId }, error: null }
          return { data: null, error: null }
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: async (resolve) => {
          if (table === 'empleados_horarios') {
            resolve({
              data: [{
                id: 'assignment-test',
                fecha_fin: null,
                horarios: {
                  id: 'sch-test',
                  nombre: 'Turno Prueba',
                  tolerancia_minutos: 10,
                  dias_config: { mar: { activo: true, entrada: '08:00', salida: '17:00' } },
                },
              }],
              error: null,
            })
            return
          }
          if (table === 'attendance_logs') {
            const events = {
              [EMP_PUNTUAL]: [
                { id: 'l1', timestamp: '2027-02-23T14:00:00.000Z', in_out_state: 0 },
                { id: 'l2', timestamp: '2027-02-23T23:00:00.000Z', in_out_state: 1 },
              ],
              [EMP_RETARDO]: [
                { id: 'l3', timestamp: '2027-02-23T14:20:00.000Z', in_out_state: 0 },
                { id: 'l4', timestamp: '2027-02-23T23:00:00.000Z', in_out_state: 1 },
              ],
              [EMP_INCOMPLETO]: [
                { id: 'l5', timestamp: '2027-02-23T14:00:00.000Z', in_out_state: 0 },
              ],
            }
            resolve({
              data: (events[builder.biometricId] || []).map((event) => ({
                ...event,
                cliente_id: SIGNUM_TEST_COMPANY,
                numero_serie: 'DEV-1',
                verify_type: 1,
              })),
              error: null,
            })
            return
          }
          resolve({ data: [], error: null })
        },
      }
      return builder
    },
    rpc: async () => {
      rpcCalls += 1
      throw new Error('The V3 browser boundary must not invoke RPC.')
    },
  }

  async function expectServerOnly(empleadoId) {
    const result = await WorkdayReprocessService.processWorkday({
      supabaseClient,
      clienteId: SIGNUM_TEST_COMPANY,
      empleadoId,
      workdayDate: '2027-02-23',
    })
    assert.equal(result.status, 'ERROR')
    assert.equal(result.error, 'WORKDAY_PERSISTENCE_SERVER_ONLY')
    assert.equal(rpcCalls, 0)
  }

  test('TEST-001: a punctual simulated workday cannot persist through the browser boundary', async () => {
    await expectServerOnly(EMP_PUNTUAL)
  })

  test('TEST-002: a late simulated workday cannot persist through the browser boundary', async () => {
    await expectServerOnly(EMP_RETARDO)
  })

  test('TEST-003: an incomplete simulated workday cannot create an incident write', async () => {
    await expectServerOnly(EMP_INCOMPLETO)
  })
})
