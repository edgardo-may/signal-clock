/** Static adversarial checks for the final 045→047 persistence definition.
 * Live exploit attempts belong to db-real.test.js and require a guarded DB.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const m045 = readFileSync(new URL('../../supabase/migrations/045_workday_records.sql', import.meta.url), 'utf8')
const m046 = readFileSync(new URL('../../supabase/migrations/046_phase2_security_hardening.sql', import.meta.url), 'utf8')
const m047 = readFileSync(new URL('../../supabase/migrations/047_phase2_stabilization.sql', import.meta.url), 'utf8')
const rpc = m047.slice(m047.indexOf('CREATE OR REPLACE FUNCTION public.upsert_workday_record'), m047.lastIndexOf('REVOKE ALL ON FUNCTION public.upsert_workday_record'))

test('DBADV-001: final RPC validates employee/client membership', () => assert.match(rpc, /id = v_empleado_id AND cliente_id = v_cliente_id/))
test('DBADV-002: final RPC validates assignment/client/employee membership', () => assert.match(rpc, /id = v_assignment_id AND cliente_id = v_cliente_id AND empleado_id = v_empleado_id/))
test('DBADV-003: SECURITY DEFINER has fixed search_path and backend-only EXECUTE', () => {
  assert.match(rpc, /SECURITY DEFINER\s+SET search_path = public, pg_temp/i)
  assert.match(m047, /REVOKE ALL ON FUNCTION public\.upsert_workday_record\(JSONB\) FROM PUBLIC, anon, authenticated/i)
  assert.match(m047, /GRANT EXECUTE ON FUNCTION public\.upsert_workday_record\(JSONB\) TO service_role/i)
})
test('DBADV-004: history UPDATE is blocked by an exception trigger', () => assert.match(m046, /RAISE EXCEPTION 'workday_record_history is append-only/))
test('DBADV-005: history DELETE is blocked by the same exception trigger', () => assert.match(m046, /BEFORE UPDATE OR DELETE ON public\.workday_record_history/))
test('DBADV-006: concurrency uses a transaction-scoped advisory lock', () => assert.match(rpc, /pg_advisory_xact_lock/))
test('DBADV-007: idempotent same-hash path returns without new history', () => assert.match(rpc, /integrity_hash = v_integrity_hash THEN\s+RETURN jsonb_build_object\('status', 'UNCHANGED'/s))
test('DBADV-008: distinct-hash updates lock the record and increment exactly once', () => {
  assert.match(rpc, /FOR UPDATE/)
  assert.match(rpc, /v_next_version := v_existing\.current_version \+ 1/)
})
test('DBADV-009: materialized update and history insert occur in one PL/pgSQL transaction', () => {
  assert.match(rpc, /UPDATE public\.workday_records SET[\s\S]*INSERT INTO public\.workday_record_history/)
  assert.doesNotMatch(rpc, /COMMIT|ROLLBACK/)
})
test('DBADV-010: one ACTIVE logical workday replaces UNSCHEDULED/scheduled split identity', () => assert.match(m047, /workday_records \(cliente_id, empleado_id, workday_date\)\s+WHERE record_state = 'ACTIVE'/s))
test('DBADV-011: schedule reassignment is preserved as a supersession, not deleted', () => {
  assert.match(rpc, /record_state='SUPERSEDED', superseded_by=v_new_id/)
  assert.match(rpc, /SCHEDULE_REASSIGNED/)
})
test('DBADV-012: source logs are constrained to tenant, employee biometric identity, and window', () => {
  assert.match(rpc, /al\.cliente_id <> v_cliente_id/)
  assert.match(rpc, /al\.biometric_user_id <> v_biometric_id/)
  assert.match(rpc, /al\."timestamp" < v_window_start OR al\."timestamp" > v_window_end/)
})
test('DBADV-013: feature flag values are constrained to OFF/SHADOW/ACTIVE', () => assert.match(m045, /CHECK \(state IN \('OFF', 'SHADOW', 'ACTIVE'\)\)/))
test('DBADV-014: malformed JSON arrays and required window fields are rejected', () => {
  assert.match(rpc, /jsonb_typeof\(payload\) <> 'object'/)
  assert.match(rpc, /source_log_ids, punch_dispositions, incidents and warnings must be arrays/)
  assert.match(rpc, /v_window_end < v_window_start/)
})
test('DBADV-015: negative stored minutes remain protected by DB checks', () => assert.match(m045, /worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK \(worked_minutes >= 0\)/))
test('DBADV-016: hash trust boundary is restricted to the backend-only RPC grant', () => {
  assert.match(rpc, /v_integrity_hash TEXT := payload->>'integrity_hash'/)
  assert.match(m047, /GRANT EXECUTE ON FUNCTION public\.upsert_workday_record\(JSONB\) TO service_role/)
})
test('DBADV-017: history version collision has a unique constraint', () => assert.match(m045, /UNIQUE \(workday_record_id, version\)/))
test('DBADV-018: snapshots and event structures are JSONB', () => {
  assert.match(m045, /snapshot JSONB NOT NULL/)
  assert.match(m045, /punch_dispositions JSONB NOT NULL/)
})
test('DBADV-019: employee/auth links enforce tenant agreement', () => assert.match(m047, /employee_user_links\.cliente_id must match empleados\.cliente_id/))
test('DBADV-020: auth_current_employee_id has safe search_path and least grant', () => {
  assert.match(m047, /auth_current_employee_id\(\)[\s\S]*SET search_path = public, pg_temp/)
  assert.match(m047, /REVOKE ALL ON FUNCTION public\.auth_current_employee_id\(\) FROM PUBLIC/)
})
