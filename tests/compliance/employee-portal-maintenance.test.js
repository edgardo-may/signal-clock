import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isEmployeePortalMaintenanceEnabled } from '../../src/features/employee/employeePortalMaintenance.js'

test('Employee portal maintenance flag is opt-in and exact', () => {
  assert.equal(isEmployeePortalMaintenanceEnabled('true'), true)
  assert.equal(isEmployeePortalMaintenanceEnabled(true), true)
  assert.equal(isEmployeePortalMaintenanceEnabled('false'), false)
  assert.equal(isEmployeePortalMaintenanceEnabled('TRUE'), false)
  assert.equal(isEmployeePortalMaintenanceEnabled(undefined), false)
})

test('maintenance gate wraps Employee routes and legacy aliases only', async () => {
  const router = await readFile(new URL('../../src/app/router.jsx', import.meta.url), 'utf8')
  for (const route of ['/employee-portal/login', '/employee-portal', '/portal-colaborador/login', '/colaborador/login', '/portal-colaborador']) {
    const start = router.indexOf(`path="${route}"`)
    assert.notEqual(start, -1, `missing route ${route}`)
    const routeText = router.slice(start, start + 450)
    assert.match(routeText, /EmployeePortalGate/, `maintenance gate missing for ${route}`)
  }
  for (const route of ['/login', '/central/login', '/biometricos']) {
    const start = router.indexOf(`path="${route}"`)
    assert.notEqual(start, -1, `missing unaffected route ${route}`)
    const routeText = router.slice(start, start + 450)
    assert.doesNotMatch(routeText, /EmployeePortalGate/, `unrelated route gated: ${route}`)
  }
})
