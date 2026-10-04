import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { auditConfig } from '../helpers/testDb.js'
import { createWorkdayEvolutionFixture } from '../helpers/workdayEvolutionDbreal.js'
import { cases, inputFor, verifyCase } from '../fixtures/phase-b-sequences.js'

const config = auditConfig()
test('Phase B DBREAL: isolated local canonical sequences', { skip: !config.ready && 'DBREAL configuration unavailable' }, async t => {
  assert.ok(['localhost','127.0.0.1'].includes(new URL(config.dbUrl).hostname))
  assert.equal(new URL(config.dbUrl).port,'54322')
  assert.ok(['localhost','127.0.0.1'].includes(new URL(config.url).hostname))
  assert.equal(config.label,'local')
  const db = new pg.Client({connectionString:config.dbUrl})
  await db.connect()
  const tables = ['clientes','empleados','devices','horarios','schedule_revisions','empleados_horarios','registro_asistencia','attendance_logs','attendance_source_events','workday_records','workday_record_history','attendance_persist_outbox']
  async function counts() {
    const result = {}
    for (const table of tables) result[table] = (await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n
    return result
  }
  let fixture, before
  try {
    before = await counts()
    await db.query('BEGIN')
    fixture = await createWorkdayEvolutionFixture(db)
    for (const c of cases) await t.test(c[0], async () => {
      await db.query('SAVEPOINT scenario')
      try {
        const input = inputFor(c,fixture.tenantA.id,fixture.employee.id)
        const ids = []
        for (const p of input.raw) {
          const { rows:[row] } = await db.query(`INSERT INTO public.registro_asistencia
            (cliente_id,empleado_id,dispositivo_id,verificado_at,tipo_verificacion,metodo,es_manual,raw_payload)
            VALUES($1,$2,$3,$4,$5,'huella',false,$6::jsonb) RETURNING id`,
            [p.clienteId,p.empleadoId,fixture.deviceA.id,p.timestamp,p.inOutState,JSON.stringify({phase:'B',originalId:p.id})])
          ids.push(row.id)
        }
        const load = async () => (await db.query('SELECT * FROM public.registro_asistencia WHERE id=ANY($1::uuid[]) ORDER BY verificado_at,id',[ids])).rows
        const rows = await load()
        assert.equal(rows.length,input.raw.length)
        input.raw = rows.map(r => ({id:r.id,clienteId:r.cliente_id,empleadoId:r.empleado_id,timestamp:r.verificado_at.toISOString(),inOutState:r.tipo_verificacion}))
        verifyCase(c,input)
        assert.deepEqual(await load(),rows,'RAW database rows remain unchanged after calculation')
      } finally { await db.query('ROLLBACK TO SAVEPOINT scenario') }
    })
  } finally {
    try {
      await db.query('ROLLBACK')
      if (before) assert.deepEqual(await counts(),before,'all table counts restored')
      if (fixture) assert.equal((await db.query('SELECT count(*)::int n FROM public.clientes WHERE id=ANY($1::uuid[])',[[fixture.tenantA.id,fixture.tenantB.id]])).rows[0].n,0)
      t.diagnostic('DBREAL_CLEAN=YES: rollback, restored counts, temporary tenants absent')
    } finally { await db.end() }
  }
})
