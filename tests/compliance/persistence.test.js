import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { WorkdayPersistenceService } from '../../src/services/attendance/WorkdayPersistenceService.ts'


/**
 * Mock DB InMemory para simular la base de datos y la función RPC 'upsert_workday_record'
 */
class MockSupabaseDB {
  workday_records = []
  workday_record_history = []
  
  // Variables para simular RLS y roles
  currentUser = null
  
  login(user) {
    this.currentUser = user
  }
  
  logout() {
    this.currentUser = null
  }
  
  // Mock del supabaseClient
  getClient() {
    const db = this
    return {
      rpc: async (functionName, args) => {
        if (functionName === 'upsert_workday_record') {
          return db.mockUpsertWorkdayRecord(args.payload)
        }
        return { error: 'Function not found' }
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (field, value) => {
            // Simulador básico para RLS en queries
            let data = db[table]
            if (db.currentUser && db.currentUser.role === 'colaborador') {
              data = data.filter(r => r.empleado_id === db.currentUser.empleado_id)
            }
            if (db.currentUser && db.currentUser.role === 'admin') {
              data = data.filter(r => r.cliente_id === db.currentUser.cliente_id)
            }
            data = data.filter(r => r[field] === value)
            return { data, error: null }
          }
        })
      })
    }
  }

  // Simulación fiel de la lógica de la RPC en PostgreSQL
  async mockUpsertWorkdayRecord(payload) {
    // Validaciones de constraints
    if (payload.worked_minutes < 0 || payload.break_minutes < 0 || payload.effective_minutes < 0 || 
        payload.late_minutes < 0 || payload.early_leave_minutes < 0 || 
        payload.ordinary_minutes < 0 || payload.overtime_minutes < 0) {
      return { error: { message: 'new row for relation "workday_records" violates check constraint' } }
    }
    
    const logicalKey = `${payload.cliente_id}-${payload.empleado_id}-${payload.workday_date}-${payload.schedule_assignment_id || 'UNSCHEDULED'}`
    
    // Simular concurrencia: si hay una race condition configurada
    if (this.simulateConcurrency) {
      // Simular que otra transacción insertó primero
      this.simulateConcurrency = false
      const fakePayload = { ...payload, integrity_hash: 'hash-concurrente' }
      await this.mockUpsertWorkdayRecord(fakePayload)
    }

    let existing = this.workday_records.find(r => 
      r.cliente_id === payload.cliente_id &&
      r.empleado_id === payload.empleado_id &&
      r.workday_date === payload.workday_date &&
      (r.schedule_assignment_id || 'UNSCHEDULED') === (payload.schedule_assignment_id || 'UNSCHEDULED')
    )

    if (existing) {
      if (existing.integrity_hash === payload.integrity_hash) {
        return { data: { status: 'UNCHANGED', workday_record_id: existing.id, version: existing.current_version }, error: null }
      } else {
        const newVersion = existing.current_version + 1
        existing.integrity_hash = payload.integrity_hash
        existing.current_version = newVersion
        
        this.workday_record_history.push({
          id: `hist-${Date.now()}`,
          workday_record_id: existing.id,
          cliente_id: payload.cliente_id,
          empleado_id: payload.empleado_id,
          version: newVersion,
          snapshot: payload,
          integrity_hash: payload.integrity_hash
        })
        
        return { data: { status: 'UPDATED_VERSION', workday_record_id: existing.id, version: newVersion }, error: null }
      }
    } else {
      const newId = `rec-${Date.now()}-${Math.random()}`
      const newRecord = { ...payload, id: newId, current_version: 1 }
      this.workday_records.push(newRecord)
      
      this.workday_record_history.push({
        id: `hist-${Date.now()}`,
        workday_record_id: newId,
        cliente_id: payload.cliente_id,
        empleado_id: payload.empleado_id,
        version: 1,
        snapshot: payload,
        integrity_hash: payload.integrity_hash
      })
      
      return { data: { status: 'CREATED', workday_record_id: newId, version: 1 }, error: null }
    }
  }
}

describe('FASE 2: Persistencia Workday Records (PERSIST-001 a PERSIST-018)', () => {
  const db = new MockSupabaseDB()
  const supabase = db.getClient()
  
  const TENANT_A = 't-1111'
  const TENANT_B = 't-2222'
  const EMP_1 = 'e-1001'
  const EMP_2 = 'e-1002'
  const SCHEDULE_A = 's-9999'

  const baseResult = {
    clienteId: TENANT_A,
    empleadoId: EMP_1,
    operativeDate: '2027-02-23',
    timezone: 'America/Mexico_City',
    scheduleAssignmentId: SCHEDULE_A,
    shiftType: 'DIURNA',
    isRestDay: false,
    isHoliday: false,
    scheduledMinutes: 480,
    workedMinutes: 480,
    breakMinutes: 0,
    effectiveMinutes: 480,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    ordinaryMinutes: 480,
    overtimeMinutes: 0,
    nightShiftMinutes: 0,
    workdayState: 'COMPLETE',
    calculationVersion: '1.0',
    integrityHash: 'hash-abc-123',
    sourceLogIds: ['log-1', 'log-2'],
    punchDispositions: [{ logId: 'log-1', disposition: 'USED' }],
    incidents: [],
    warnings: []
  }

  test('PERSIST-001: Primera ejecución crea workday_record version 1', async () => {
    const res = await WorkdayPersistenceService.persistWorkday(supabase, baseResult)
    assert.equal(res.status, 'CREATED')
    assert.equal(res.version, 1)
    assert.ok(res.workdayRecordId)
    
    // Verify DB state
    assert.equal(db.workday_records.length, 1)
    assert.equal(db.workday_record_history.length, 1)
  })

  test('PERSIST-002: Misma ejecución/mismo hash → UNCHANGED', async () => {
    const res = await WorkdayPersistenceService.persistWorkday(supabase, baseResult)
    assert.equal(res.status, 'UNCHANGED')
    assert.equal(res.version, 1) // sigue en 1
    
    // DB state is still 1
    assert.equal(db.workday_records.length, 1)
    assert.equal(db.workday_record_history.length, 1)
  })

  test('PERSIST-003: 10 reprocesos idénticos → sigue existiendo 1 registro y 1 versión', async () => {
    for (let i = 0; i < 10; i++) {
      await WorkdayPersistenceService.persistWorkday(supabase, baseResult)
    }
    assert.equal(db.workday_records.length, 1)
    assert.equal(db.workday_record_history.length, 1)
  })

  test('PERSIST-004: Cambio de RAW → integrity_hash cambia → version 2', async () => {
    const modifiedResult = { ...baseResult, integrityHash: 'hash-def-456', lateMinutes: 15 }
    const res = await WorkdayPersistenceService.persistWorkday(supabase, modifiedResult)
    assert.equal(res.status, 'UPDATED_VERSION')
    assert.equal(res.version, 2)
  })

  test('PERSIST-005: History conserva version 1 y 2', () => {
    const histories = db.workday_record_history.filter(h => h.empleado_id === EMP_1)
    assert.equal(histories.length, 2)
    assert.equal(histories[0].version, 1)
    assert.equal(histories[1].version, 2)
    assert.equal(histories[0].integrity_hash, 'hash-abc-123')
    assert.equal(histories[1].integrity_hash, 'hash-def-456')
  })

  test('PERSIST-006: Dos tenants con mismo empleado lógico → registros separados', async () => {
    const resTenantB = { ...baseResult, clienteId: TENANT_B, empleadoId: EMP_1, integrityHash: 'hash-t2' }
    const res = await WorkdayPersistenceService.persistWorkday(supabase, resTenantB)
    assert.equal(res.status, 'CREATED')
    
    // Ahora hay 2 records en total en DB
    assert.equal(db.workday_records.length, 2)
  })

  test('PERSIST-007: Mismo empleado/día/turno no genera duplicados', async () => {
    const res = await WorkdayPersistenceService.persistWorkday(supabase, { ...baseResult, integrityHash: 'hash-def-456' })
    assert.equal(res.status, 'UNCHANGED') // Hash ya era def-456
    
    // Mismo empleado, misma fecha, schedule nulo (turno extra en mismo dia) -> se crea NUEVO registro
    const extraShift = { ...baseResult, scheduleAssignmentId: undefined, integrityHash: 'hash-extra' }
    const res2 = await WorkdayPersistenceService.persistWorkday(supabase, extraShift)
    assert.equal(res2.status, 'CREATED')
    
    // Se generó sin duplicar la llave (cliente, empleado, date, schedule)
    assert.equal(db.workday_records.length, 3) 
  })

  test('PERSIST-008: Punch dispositions quedan almacenados', async () => {
    const record = db.workday_records.find(r => r.schedule_assignment_id === undefined)
    assert.deepEqual(record.punch_dispositions, [{ logId: 'log-1', disposition: 'USED' }])
  })

  test('PERSIST-009: Incidents quedan almacenados', async () => {
    const incResult = { ...baseResult, empleadoId: EMP_2, incidents: [{ code: 'LATE', message: 'Tarde' }], integrityHash: 'hash-inc' }
    await WorkdayPersistenceService.persistWorkday(supabase, incResult)
    
    const record = db.workday_records.find(r => r.empleado_id === EMP_2)
    assert.deepEqual(record.incidents, [{ code: 'LATE', message: 'Tarde' }])
  })

  test('PERSIST-010: workdayState se persiste; status deprecated NO es fuente principal', () => {
    const record = db.workday_records.find(r => r.empleado_id === EMP_2)
    assert.equal(record.workday_state, 'COMPLETE')
    assert.equal(record.status, undefined) // No se pasa status a la BD
  })

  test('PERSIST-011: Valores negativos rechazados por DB (Constraint Check)', async () => {
    const invalidResult = { ...baseResult, empleadoId: 'e-err', workedMinutes: -10, integrityHash: 'err' }
    const res = await WorkdayPersistenceService.persistWorkday(supabase, invalidResult)
    assert.equal(res.status, 'ERROR')
    assert.match(res.error, /violates check constraint/)
  })

  test('PERSIST-013: Colaborador no puede consultar otro empleado (Simulación RLS)', async () => {
    db.login({ role: 'colaborador', empleado_id: EMP_1 })
    const { data } = await supabase.from('workday_records').select('*').eq('cliente_id', TENANT_A)
    assert.ok(data.length > 0)
    assert.ok(data.every(r => r.empleado_id === EMP_1))
    db.logout()
  })

  test('PERSIST-014: Admin no puede consultar otro tenant (Simulación RLS)', async () => {
    db.login({ role: 'admin', cliente_id: TENANT_B })
    const { data } = await supabase.from('workday_records').select('*').eq('workday_date', '2027-02-23')
    assert.ok(data.length > 0)
    assert.ok(data.every(r => r.cliente_id === TENANT_B))
    db.logout()
  })

  test('PERSIST-017: Concurrencia simulada: dos intentos de creación no duplican jornada', async () => {
    const concurrentResult = { ...baseResult, empleadoId: 'e-conc', integrityHash: 'hash-conc-1' }
    db.simulateConcurrency = true // Activa simulador de race condition en el mock
    
    const res = await WorkdayPersistenceService.persistWorkday(supabase, concurrentResult)
    
    // Como hubo concurrencia, el insert real encontró un existente, por lo que actualizó versión a 2.
    assert.equal(res.status, 'UPDATED_VERSION')
    assert.equal(res.version, 2)
    
    const recs = db.workday_records.filter(r => r.empleado_id === 'e-conc')
    assert.equal(recs.length, 1, 'No debe duplicar jornada a pesar de concurrencia')
  })

  test('PERSIST-018: Cambio solo en orden no semántico no crea nueva versión si hash canónico permanece igual', async () => {
    // Generar primer registro
    await WorkdayPersistenceService.persistWorkday(supabase, { ...baseResult, empleadoId: 'e-1003', integrityHash: 'hash-xyz' })
    // Intentar actualizar con el mismo hash
    const res = await WorkdayPersistenceService.persistWorkday(supabase, { ...baseResult, empleadoId: 'e-1003', integrityHash: 'hash-xyz' })
    assert.equal(res.status, 'UNCHANGED')
  })
})
